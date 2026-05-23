import { query } from "../../config/database";
import { writeAuditLog } from "../../middleware/audit";
import { logger } from "../../utils/logger";
import { TwilioService } from "../integrations/twilio";
import { AuthRequest } from "../../middleware/auth";
import { buildPropertyScope } from "../../middleware/scope";
import { RecertComplianceService } from "../acquisitions/recert-compliance";

export class RecertificationService {
  private twilio = new TwilioService();
  private compliance = new RecertComplianceService();

  /**
   * Create an annual recertification record for a newly onboarded tenant.
   * Anniversary = 1st of the move-in month + 1 year.
   * Cutoff = 10th day of 11th month (anniversary minus 1 month, day 10).
   * TRACS deadline = anniversary + 15 months.
   */
  async createForApplication(
    applicationId: string,
    actorId: string,
    actorRole: string
  ): Promise<{ id: string; anniversaryDate: string }> {
    const appResult = await query(
      `SELECT a.id, a.first_name, a.last_name, a.property_id, a.lease_start_date, a.annual_income
       FROM applications a WHERE a.id = $1`,
      [applicationId]
    );
    if (appResult.rows.length === 0) throw new Error("Application not found");
    const app = appResult.rows[0];

    if (!app.lease_start_date) {
      throw new Error("Cannot create recertification: lease_start_date is not set");
    }

    const leaseStart = new Date(app.lease_start_date);
    const anniversary = new Date(leaseStart.getFullYear() + 1, leaseStart.getMonth(), 1);
    const cutoff = new Date(anniversary.getFullYear(), anniversary.getMonth() - 1, 10);
    const tracsDeadline = new Date(anniversary.getFullYear(), anniversary.getMonth() + 15, anniversary.getDate());

    const result = await query(
      `INSERT INTO recertifications
         (application_id, property_id, tenant_name, type, status,
          anniversary_date, cutoff_date, tracs_deadline, previous_annual_income)
       VALUES ($1, $2, $3, 'annual', 'pending', $4, $5, $6, $7)
       RETURNING id`,
      [
        applicationId,
        app.property_id,
        `${app.first_name} ${app.last_name}`,
        anniversary.toISOString().split("T")[0],
        cutoff.toISOString().split("T")[0],
        tracsDeadline.toISOString().split("T")[0],
        app.annual_income || 0,
      ]
    );

    const recertId = result.rows[0].id;

    await writeAuditLog({
      action: "recertification_created",
      actorId,
      actorRole,
      applicationId,
      resourceType: "recertification",
      resourceId: recertId,
      details: {
        anniversaryDate: anniversary.toISOString().split("T")[0],
        cutoffDate: cutoff.toISOString().split("T")[0],
      },
    });

    logger.info("Recertification created", { recertId, applicationId, anniversary: anniversary.toISOString().split("T")[0] });

    return { id: recertId, anniversaryDate: anniversary.toISOString().split("T")[0] };
  }

  /**
   * Process all pending reminders — called daily by the scheduler.
   * Idempotent: only sends reminders whose _sent_at is NULL and date is due.
   */
  async processReminders(): Promise<{ processed: number; reminded: number; overdue: number; marketRent: number }> {
    const now = new Date();
    const stats = { processed: 0, reminded: 0, overdue: 0, marketRent: 0 };

    // Fetch all non-terminal recertifications with anniversary within 120 days or past
    const result = await query(
      `SELECT r.*, a.phone, a.first_name, a.last_name
       FROM recertifications r
       JOIN applications a ON r.application_id = a.id
       WHERE r.status IN ('pending', 'reminder_120', 'reminder_90', 'reminder_60', 'overdue')
         AND r.anniversary_date <= (CURRENT_DATE + INTERVAL '120 days')
       ORDER BY r.anniversary_date ASC`
    );

    for (const rec of result.rows) {
      stats.processed++;
      const anniv = new Date(rec.anniversary_date);
      const daysUntil = Math.ceil((anniv.getTime() - now.getTime()) / 86400000);
      const phone = rec.phone;
      const name = `${rec.first_name} ${rec.last_name}`;

      // Market rent: past anniversary and still overdue
      if (daysUntil < 0 && rec.status === "overdue") {
        await query(
          `UPDATE recertifications SET status = 'market_rent_applied', market_rent_applied_at = NOW()
           WHERE id = $1`,
          [rec.id]
        );
        await writeAuditLog({
          action: "market_rent_applied",
          actorId: "system",
          actorRole: "system_admin",
          applicationId: rec.application_id,
          resourceType: "recertification",
          resourceId: rec.id,
          details: { reason: "Non-responsive past anniversary date" },
        });
        if (phone) {
          this.twilio.sendSMS(phone, `${name}: Your rent has been adjusted to market rate due to non-completion of annual recertification.`).catch(() => {});
        }
        stats.marketRent++;
        continue;
      }

      // Overdue: past cutoff date
      if (daysUntil < 30 && !["overdue", "market_rent_applied"].includes(rec.status) && now > new Date(rec.cutoff_date)) {
        await query(`UPDATE recertifications SET status = 'overdue' WHERE id = $1`, [rec.id]);
        await writeAuditLog({
          action: "recertification_overdue",
          actorId: "system",
          actorRole: "system_admin",
          applicationId: rec.application_id,
          resourceType: "recertification",
          resourceId: rec.id,
          details: { cutoffDate: rec.cutoff_date },
        });
        stats.overdue++;
        continue;
      }

      // 60-day reminder
      if (daysUntil <= 60 && !rec.reminder_60_sent_at) {
        await query(
          `UPDATE recertifications SET reminder_60_sent_at = NOW(), status = 'reminder_60' WHERE id = $1`,
          [rec.id]
        );
        if (phone) {
          this.twilio.sendSMS(phone, `URGENT — ${name}: Your annual recertification for ${rec.tenant_name} is due in ${daysUntil} days. Failure to complete by the cutoff date may result in rent adjustment to market rate. Contact your property manager immediately.`).catch(() => {});
        }
        await this.logReminderSent(rec, "60-day");
        stats.reminded++;
        continue;
      }

      // 90-day reminder
      if (daysUntil <= 90 && !rec.reminder_90_sent_at) {
        await query(
          `UPDATE recertifications SET reminder_90_sent_at = NOW(), status = 'reminder_90' WHERE id = $1`,
          [rec.id]
        );
        if (phone) {
          this.twilio.sendSMS(phone, `REMINDER — ${name}: Your annual recertification is due in ${daysUntil} days. Please submit required documents to your property manager.`).catch(() => {});
        }
        await this.logReminderSent(rec, "90-day");
        stats.reminded++;
        continue;
      }

      // 120-day reminder
      if (daysUntil <= 120 && !rec.reminder_120_sent_at) {
        await query(
          `UPDATE recertifications SET reminder_120_sent_at = NOW(), status = 'reminder_120' WHERE id = $1`,
          [rec.id]
        );
        if (phone) {
          this.twilio.sendSMS(phone, `${name}: Your annual recertification is approaching. Anniversary date: ${anniv.toLocaleDateString()}. Please begin gathering income verification documents.`).catch(() => {});
        }
        await this.logReminderSent(rec, "120-day");
        stats.reminded++;
      }
    }

    logger.info("Recertification reminders processed", stats);
    return stats;
  }

  /**
   * Submit recertification (tenant/staff provides documents).
   */
  async submit(
    recertId: string,
    actorId: string,
    actorRole: string,
    newIncome?: number
  ): Promise<void> {
    const result = await query(
      `UPDATE recertifications
       SET status = 'submitted', submitted_at = NOW(), submitted_by = $2,
           new_annual_income = $3
       WHERE id = $1 AND status IN ('pending', 'reminder_120', 'reminder_90', 'reminder_60', 'overdue')
       RETURNING id, application_id`,
      [recertId, actorId, newIncome || null]
    );
    if (result.rows.length === 0) throw new Error("Recertification not found or not in submittable state");

    await writeAuditLog({
      action: "recertification_submitted",
      actorId,
      actorRole,
      applicationId: result.rows[0].application_id,
      resourceType: "recertification",
      resourceId: recertId,
      details: { newIncome },
    });

    // QAP Phase 3.1: measure the recertified income against the unit's AMI
    // ceiling (140% Available Unit Rule) and snapshot/stamp the verdict.
    // Best-effort — a compliance hiccup must never block the submission.
    try {
      await this.compliance.check(recertId, { income: newIncome ?? null, actorId });
    } catch (err: any) {
      logger.error("Recert income-ceiling check failed on submit (non-fatal)", { recertId, error: err?.message });
    }
  }

  /**
   * Review and approve/deny a submitted recertification.
   */
  async review(
    recertId: string,
    actorId: string,
    actorRole: string,
    decision: "pass" | "fail",
    notes: string,
    newIncome?: number,
    rentAdjustment?: number
  ): Promise<void> {
    const status = decision === "pass" ? "approved" : "denied";

    const result = await query(
      `UPDATE recertifications
       SET status = $2, reviewer_id = $3, reviewed_at = NOW(), review_decision = $4,
           review_notes = $5, new_annual_income = COALESCE($6, new_annual_income),
           rent_adjustment = $7
       WHERE id = $1 AND status IN ('submitted', 'under_review')
       RETURNING id, application_id`,
      [recertId, status, actorId, decision, notes, newIncome || null, rentAdjustment || null]
    );
    if (result.rows.length === 0) throw new Error("Recertification not found or not in reviewable state");

    const auditAction = decision === "pass" ? "recertification_approved" : "recertification_denied";
    await writeAuditLog({
      action: auditAction,
      actorId,
      actorRole,
      applicationId: result.rows[0].application_id,
      resourceType: "recertification",
      resourceId: recertId,
      details: { decision, notes, rentAdjustment },
    });

    // QAP Phase 3.1: re-evaluate the income ceiling against the reviewed
    // income (now persisted) and stamp the verdict under the reviewer's actor.
    // The reviewer acts on this verdict; we never auto-change their decision.
    try {
      await this.compliance.check(recertId, { income: newIncome ?? null, actorId });
    } catch (err: any) {
      logger.error("Recert income-ceiling check failed on review (non-fatal)", { recertId, error: err?.message });
    }

    // If approved, create next year's recertification automatically
    if (decision === "pass") {
      const recert = await this.getById(recertId);
      if (recert) {
        const nextAnniv = new Date(recert.anniversaryDate);
        nextAnniv.setFullYear(nextAnniv.getFullYear() + 1);
        const nextCutoff = new Date(nextAnniv.getFullYear(), nextAnniv.getMonth() - 1, 10);
        const nextTracs = new Date(nextAnniv.getFullYear(), nextAnniv.getMonth() + 15, nextAnniv.getDate());

        await query(
          `INSERT INTO recertifications
             (application_id, property_id, tenant_name, type, status,
              anniversary_date, cutoff_date, tracs_deadline, previous_annual_income)
           VALUES ($1, $2, $3, 'annual', 'pending', $4, $5, $6, $7)`,
          [
            recert.applicationId, recert.propertyId, recert.tenantName,
            nextAnniv.toISOString().split("T")[0],
            nextCutoff.toISOString().split("T")[0],
            nextTracs.toISOString().split("T")[0],
            newIncome || recert.previousAnnualIncome,
          ]
        );
      }
    }
  }

  async getById(recertId: string, req?: AuthRequest): Promise<RecertificationRecord | null> {
    const conditions = ["id = $1"];
    const params: unknown[] = [recertId];
    if (req) {
      const scope = buildPropertyScope(req, params.length + 1, "property_id");
      if (scope.denyAll) return null;
      if (scope.sql) { conditions.push(scope.sql); params.push(scope.param); }
    }
    const result = await query(
      `SELECT * FROM recertifications WHERE ${conditions.join(" AND ")}`,
      params
    );
    if (result.rows.length === 0) return null;
    return this.rowToRecord(result.rows[0]);
  }

  async list(filters: {
    status?: string;
    propertyId?: string;
    limit?: number;
    offset?: number;
  } = {}, req?: AuthRequest): Promise<{ recertifications: RecertificationRecord[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.status) {
      params.push(filters.status);
      conditions.push(`r.status = $${params.length}`);
    }
    if (filters.propertyId) {
      params.push(filters.propertyId);
      conditions.push(`r.property_id = $${params.length}`);
    }

    if (req) {
      const scope = buildPropertyScope(req, params.length + 1, "r.property_id");
      if (scope.denyAll) return { recertifications: [], total: 0 };
      if (scope.sql) { conditions.push(scope.sql); params.push(scope.param); }
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filters.limit || 50;
    const offset = filters.offset || 0;

    const countResult = await query(
      `SELECT COUNT(*) FROM recertifications r ${where}`,
      params
    );

    const dataResult = await query(
      `SELECT r.*, p.name as property_name
       FROM recertifications r
       JOIN properties p ON r.property_id = p.id
       ${where}
       ORDER BY r.anniversary_date ASC
       LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    return {
      recertifications: dataResult.rows.map(this.rowToRecord),
      total: parseInt(countResult.rows[0].count),
    };
  }

  async getUpcoming(days: number = 60, req?: AuthRequest): Promise<RecertificationRecord[]> {
    const conditions = [
      "r.status NOT IN ('approved', 'denied', 'market_rent_applied')",
      "r.anniversary_date <= (CURRENT_DATE + $1 * INTERVAL '1 day')",
    ];
    const params: unknown[] = [days];
    if (req) {
      const scope = buildPropertyScope(req, params.length + 1, "r.property_id");
      if (scope.denyAll) return [];
      if (scope.sql) { conditions.push(scope.sql); params.push(scope.param); }
    }
    const result = await query(
      `SELECT r.*, p.name as property_name
       FROM recertifications r
       JOIN properties p ON r.property_id = p.id
       WHERE ${conditions.join(" AND ")}
       ORDER BY r.anniversary_date ASC`,
      params
    );
    return result.rows.map(this.rowToRecord);
  }

  private async logReminderSent(rec: any, reminderType: string): Promise<void> {
    await writeAuditLog({
      action: "recertification_reminder_sent",
      actorId: "system",
      actorRole: "system_admin",
      applicationId: rec.application_id,
      resourceType: "recertification",
      resourceId: rec.id,
      details: { reminderType, anniversaryDate: rec.anniversary_date },
    });
  }

  private rowToRecord(row: any): RecertificationRecord {
    return {
      id: row.id,
      applicationId: row.application_id,
      propertyId: row.property_id,
      propertyName: row.property_name || null,
      tenantName: row.tenant_name,
      type: row.type,
      status: row.status,
      anniversaryDate: row.anniversary_date?.toISOString?.()?.split("T")[0] || row.anniversary_date,
      cutoffDate: row.cutoff_date?.toISOString?.()?.split("T")[0] || row.cutoff_date,
      tracsDeadline: row.tracs_deadline?.toISOString?.()?.split("T")[0] || row.tracs_deadline,
      reminder120SentAt: row.reminder_120_sent_at || null,
      reminder90SentAt: row.reminder_90_sent_at || null,
      reminder60SentAt: row.reminder_60_sent_at || null,
      submittedAt: row.submitted_at || null,
      submittedBy: row.submitted_by || null,
      reviewerId: row.reviewer_id || null,
      reviewedAt: row.reviewed_at || null,
      reviewNotes: row.review_notes || null,
      reviewDecision: row.review_decision || null,
      previousAnnualIncome: row.previous_annual_income ? parseFloat(row.previous_annual_income) : null,
      newAnnualIncome: row.new_annual_income ? parseFloat(row.new_annual_income) : null,
      rentAdjustment: row.rent_adjustment ? parseFloat(row.rent_adjustment) : null,
      marketRentAppliedAt: row.market_rent_applied_at || null,
      marketRentAmount: row.market_rent_amount ? parseFloat(row.market_rent_amount) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export interface RecertificationRecord {
  id: string;
  applicationId: string;
  propertyId: string;
  propertyName: string | null;
  tenantName: string;
  type: "annual" | "interim";
  status: string;
  anniversaryDate: string;
  cutoffDate: string;
  tracsDeadline: string;
  reminder120SentAt: string | null;
  reminder90SentAt: string | null;
  reminder60SentAt: string | null;
  submittedAt: string | null;
  submittedBy: string | null;
  reviewerId: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  reviewDecision: string | null;
  previousAnnualIncome: number | null;
  newAnnualIncome: number | null;
  rentAdjustment: number | null;
  marketRentAppliedAt: string | null;
  marketRentAmount: number | null;
  createdAt: Date;
  updatedAt: Date;
}
