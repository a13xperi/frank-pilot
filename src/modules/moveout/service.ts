import { query, transaction } from "../../config/database";
import { writeAuditLog } from "../../middleware/audit";
import { logger } from "../../utils/logger";
import { TwilioService } from "../integrations/twilio";
import { AuthRequest } from "../../middleware/auth";
import { buildPropertyScope } from "../../middleware/scope";
import { resolveUnitIdForApplication } from "../../utils/resolve-unit";

// Pre-state guards for the move-out inspection state machine.
// Pre-inspection may run from notice_received or pre_inspection_scheduled.
// Final-inspection may run from vacated or pre_inspection_complete.
const ALLOWED_INSPECTION_FROM: Record<"pre" | "final", string[]> = {
  pre: ["notice_received", "pre_inspection_scheduled"],
  final: ["vacated", "pre_inspection_complete"],
};

// NV law NRS 118A.242: 21 calendar days to return deposit after vacate
const DEPOSIT_RETURN_DAYS = 21;
// Master Build List: collections referral at Day 45 after move-out
const COLLECTIONS_REFERRAL_DAYS = 45;

export class MoveOutService {
  private twilio = new TwilioService();

  async initiate(
    applicationId: string,
    noticeDate: string,
    forwardingAddress: string,
    actorId: string,
    actorRole: string
  ): Promise<{ id: string }> {
    const app = await query(
      `SELECT a.id, a.property_id, a.security_deposit_amount, a.first_name, a.last_name, a.phone
       FROM applications a WHERE a.id = $1 AND a.status = 'onboarded'`,
      [applicationId]
    );
    if (app.rows.length === 0) throw new Error("Onboarded application not found");
    const a = app.rows[0];

    const notice = new Date(noticeDate);
    const expectedVacate = new Date(notice);
    expectedVacate.setDate(expectedVacate.getDate() + 30);
    const depositDeadline = new Date(expectedVacate);
    depositDeadline.setDate(depositDeadline.getDate() + DEPOSIT_RETURN_DAYS);

    // Get unpaid balance from ledger
    const balResult = await query(
      `SELECT COALESCE(SUM(amount), 0) as balance FROM tenant_ledger
       WHERE application_id = $1 AND status = 'posted'`,
      [applicationId]
    );

    const result = await query(
      `INSERT INTO move_outs
         (application_id, property_id, notice_date, expected_vacate_date,
          forwarding_address, deposit_amount, deposit_deadline, unpaid_rent_balance, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        applicationId, a.property_id, noticeDate,
        expectedVacate.toISOString().split("T")[0],
        forwardingAddress,
        a.security_deposit_amount || 0,
        depositDeadline.toISOString().split("T")[0],
        Math.max(0, parseFloat(balResult.rows[0].balance)),
        actorId,
      ]
    );

    await writeAuditLog({
      action: "moveout_initiated",
      actorId, actorRole, applicationId,
      resourceType: "move_out",
      resourceId: result.rows[0].id,
      details: { noticeDate, expectedVacate: expectedVacate.toISOString().split("T")[0] },
    });

    if (a.phone) {
      this.twilio.sendSMS(a.phone,
        `${a.first_name} ${a.last_name}: Your 30-day notice to vacate has been received. Expected move-out: ${expectedVacate.toLocaleDateString()}. A pre-move-out inspection will be scheduled within 48 hours.`
      ).catch(() => {});
    }

    return { id: result.rows[0].id };
  }

  async recordInspection(
    moveOutId: string,
    inspectionType: "pre" | "final",
    notes: string,
    actorId: string,
    actorRole: string
  ): Promise<void> {
    const col = inspectionType === "pre" ? "pre_inspection" : "final_inspection";
    const statusUpdate = inspectionType === "pre" ? "pre_inspection_complete" : "final_inspection_complete";
    const allowedFrom = ALLOWED_INSPECTION_FROM[inspectionType];

    // Conditional UPDATE: only succeeds if status is in the allowed pre-states.
    // This atomically enforces the state machine — no TOCTOU window.
    const result = await query(
      `UPDATE move_outs
       SET ${col}_date = CURRENT_DATE, ${col}_notes = $2, status = $3
       WHERE id = $1 AND status = ANY($4)
       RETURNING application_id`,
      [moveOutId, notes, statusUpdate, allowedFrom]
    );
    if (result.rows.length === 0) {
      // Distinguish "not found" from "wrong state" for a helpful 400
      const exists = await query(`SELECT status FROM move_outs WHERE id = $1`, [moveOutId]);
      if (exists.rows.length === 0) throw new Error("Move-out not found");
      throw new Error(
        `Invalid status transition: cannot record ${inspectionType} inspection from status '${exists.rows[0].status}'`
      );
    }

    await writeAuditLog({
      action: "moveout_inspection_completed",
      actorId, actorRole,
      applicationId: result.rows[0].application_id,
      resourceType: "move_out",
      resourceId: moveOutId,
      details: { inspectionType, notes },
    });
  }

  async calculateDeposit(
    moveOutId: string,
    deductions: Record<string, number>,
    actorId: string,
    actorRole: string
  ): Promise<{ refundAmount: number; deductionsTotal: number }> {
    const mo = await query(`SELECT * FROM move_outs WHERE id = $1`, [moveOutId]);
    if (mo.rows.length === 0) throw new Error("Move-out not found");
    const m = mo.rows[0];

    // Get current unpaid balance from ledger
    const balResult = await query(
      `SELECT COALESCE(SUM(amount), 0) as balance FROM tenant_ledger
       WHERE application_id = $1 AND status = 'posted'`,
      [m.application_id]
    );
    const unpaidRent = Math.max(0, parseFloat(balResult.rows[0].balance));

    const deductionsTotal = Object.values(deductions).reduce((sum, v) => sum + v, 0);
    const deposit = parseFloat(m.deposit_amount || "0");
    const refundAmount = Math.max(0, deposit - deductionsTotal - unpaidRent);

    await query(
      `UPDATE move_outs SET status = 'deposit_calculated',
         deductions_total = $2, deductions_detail = $3, refund_amount = $4, unpaid_rent_balance = $5
       WHERE id = $1`,
      [moveOutId, deductionsTotal, JSON.stringify(deductions), refundAmount, unpaidRent]
    );

    await writeAuditLog({
      action: "deposit_disposition_calculated",
      actorId, actorRole,
      applicationId: m.application_id,
      resourceType: "move_out",
      resourceId: moveOutId,
      details: { deposit, deductions, deductionsTotal, unpaidRent, refundAmount },
    });

    return { refundAmount, deductionsTotal };
  }

  async sendRefund(moveOutId: string, actorId: string, actorRole: string): Promise<void> {
    // Idempotent + atomic: the conditional UPDATE flips status only if it is
    // currently 'deposit_calculated' (the only valid pre-state for sending the
    // refund). If a second call lands, 0 rows are returned and we throw — the
    // ledger credit never double-posts.
    await transaction(async (client) => {
      // Application-scoped advisory lock to serialise concurrent attempts.
      // Pre-fetch application_id from the row so we can lock on it before the
      // status flip — anyone else trying to refund the same tenant will queue.
      const lookup = await client.query(
        `SELECT application_id FROM move_outs WHERE id = $1`,
        [moveOutId]
      );
      if (lookup.rows.length === 0) throw new Error("Move-out not found");
      const applicationId = lookup.rows[0].application_id;
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtext($1))`,
        [`ledger:${applicationId}`]
      );

      const updated = await client.query(
        `UPDATE move_outs
         SET status = 'deposit_sent', deposit_disposition_date = CURRENT_DATE
         WHERE id = $1 AND status = 'deposit_calculated'
         RETURNING *`,
        [moveOutId]
      );
      if (updated.rows.length === 0) {
        throw new Error("Refund already sent or move-out not ready");
      }
      const m = updated.rows[0];

      // 21-day compliance audit signal
      const deadline = m.deposit_deadline ? new Date(m.deposit_deadline) : null;
      const today = new Date();
      const onTime = deadline ? today <= deadline : true;
      if (deadline && today > deadline) {
        logger.warn("Deposit refund sent AFTER 21-day deadline", {
          moveOutId,
          deadline: m.deposit_deadline,
        });
      }

      // Post refund credit to the tenant ledger inside the same txn.
      const refundAmount = parseFloat(m.refund_amount || "0");
      if (refundAmount > 0) {
        const currentBal = await client.query(
          `SELECT COALESCE(SUM(amount), 0) as balance FROM tenant_ledger
           WHERE application_id = $1 AND status = 'posted'`,
          [m.application_id]
        );
        const billingPeriod = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
        // Anchor the refund credit to the unit: prefer the move-out's own
        // unit_id, else resolve from the application (null-tolerant).
        const unitId =
          m.unit_id ??
          (await resolveUnitIdForApplication(
            (t, p) => client.query(t, p),
            m.application_id
          ));
        await client.query(
          `INSERT INTO tenant_ledger
             (application_id, property_id, unit_id, entry_type, description, amount, balance_after,
              billing_period, posted_by)
           VALUES ($1, $2, $3, 'credit', 'Security deposit refund', $4, $5, $6, $7)`,
          [
            m.application_id, m.property_id, unitId,
            -refundAmount,
            parseFloat(currentBal.rows[0].balance) - refundAmount,
            billingPeriod,
            actorId,
          ]
        );
      }

      await writeAuditLog({
        action: "deposit_refund_sent",
        actorId, actorRole,
        applicationId: m.application_id,
        resourceType: "move_out",
        resourceId: moveOutId,
        details: { refundAmount: m.refund_amount, deadline: m.deposit_deadline, onTime },
      });
    });
  }

  async getDeadlines(req?: AuthRequest): Promise<any[]> {
    const conditions = [
      "mo.status NOT IN ('closed', 'collections')",
      "mo.deposit_deadline IS NOT NULL",
    ];
    const params: unknown[] = [];
    if (req) {
      const scope = buildPropertyScope(req, params.length + 1, "mo.property_id");
      if (scope.denyAll) return [];
      if (scope.sql) { conditions.push(scope.sql); params.push(scope.param); }
    }
    const result = await query(
      `SELECT mo.*, a.first_name || ' ' || a.last_name as tenant_name, p.name as property_name
       FROM move_outs mo
       JOIN applications a ON mo.application_id = a.id
       JOIN properties p ON mo.property_id = p.id
       WHERE ${conditions.join(" AND ")}
       ORDER BY mo.deposit_deadline ASC`,
      params
    );
    return result.rows;
  }

  async list(filters: { status?: string; propertyId?: string } = {}, req?: AuthRequest): Promise<any[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filters.status) { params.push(filters.status); conditions.push(`mo.status = $${params.length}`); }
    if (filters.propertyId) { params.push(filters.propertyId); conditions.push(`mo.property_id = $${params.length}`); }
    if (req) {
      const scope = buildPropertyScope(req, params.length + 1, "mo.property_id");
      if (scope.denyAll) return [];
      if (scope.sql) { conditions.push(scope.sql); params.push(scope.param); }
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await query(
      `SELECT mo.*, a.first_name || ' ' || a.last_name as tenant_name, p.name as property_name
       FROM move_outs mo
       JOIN applications a ON mo.application_id = a.id
       JOIN properties p ON mo.property_id = p.id
       ${where} ORDER BY mo.created_at DESC`,
      params
    );
    return result.rows;
  }

  async getById(id: string, req?: AuthRequest): Promise<any> {
    const conditions = ["mo.id = $1"];
    const params: unknown[] = [id];
    if (req) {
      const scope = buildPropertyScope(req, params.length + 1, "mo.property_id");
      if (scope.denyAll) return null;
      if (scope.sql) { conditions.push(scope.sql); params.push(scope.param); }
    }
    const result = await query(
      `SELECT mo.*, a.first_name || ' ' || a.last_name as tenant_name, p.name as property_name
       FROM move_outs mo
       JOIN applications a ON mo.application_id = a.id
       JOIN properties p ON mo.property_id = p.id
       WHERE ${conditions.join(" AND ")}`,
      params
    );
    return result.rows[0] || null;
  }
}
