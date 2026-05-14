import { query } from "../../config/database";
import { writeAuditLog } from "../../middleware/audit";
import { logger } from "../../utils/logger";
import { TwilioService } from "../integrations/twilio";
import { AuthRequest } from "../../middleware/auth";
import { buildPropertyScope } from "../../middleware/scope";

// Eviction case status state machine (eviction_case_status enum)
const VALID_CASE_STATUSES = [
  "pre_filing",
  "notice_served",
  "notice_expired",
  "filed",
  "hearing_scheduled",
  "judgment",
  "writ_issued",
  "executed",
  "dismissed",
  "settled",
] as const;
export type EvictionCaseStatus = (typeof VALID_CASE_STATUSES)[number];
export const EVICTION_CASE_STATUSES = VALID_CASE_STATUSES;

// Legal transitions only — anything else is rejected with a 400.
const VALID_TRANSITIONS: Record<EvictionCaseStatus, EvictionCaseStatus[]> = {
  pre_filing: ["notice_served", "dismissed"],
  notice_served: ["notice_expired", "dismissed", "settled"],
  notice_expired: ["filed", "dismissed", "settled"],
  filed: ["hearing_scheduled", "dismissed", "settled"],
  hearing_scheduled: ["judgment", "dismissed", "settled"],
  judgment: ["writ_issued", "dismissed", "settled"],
  writ_issued: ["executed", "dismissed", "settled"],
  executed: [],
  dismissed: [],
  settled: [],
};

// Notice period days per NRS
const NOTICE_PERIODS: Record<string, number> = {
  pay_or_quit_7day: 7,
  perform_or_quit_5day: 5,
  quit_tenancy_at_will_5day: 5,
  unlawful_detainer_5day: 5,
  no_cause_7day: 7,
  no_cause_30day: 30,
  nonpayment_cares_30day: 30,
  nuisance_quit_3day: 3,
  cure_or_quit_5day: 5,
  rent_increase_30day: 30,
};

// Material breach types — single violation = grounds for eviction
const MATERIAL_BREACH_TYPES = new Set(["drug_violation", "criminal_activity"]);

// Constable instructions by jurisdiction
const CONSTABLE_INSTRUCTIONS: Record<string, string> = {
  "Las Vegas": "File with Las Vegas Justice Court. Constable: LVMPD Civil Division, 400 S Martin L King Blvd, Las Vegas, NV 89106. Phone: (702) 455-4267.",
  "Henderson": "File with Henderson Justice Court. Constable: Henderson Constable Office, 243 S Water St, Henderson, NV 89015. Phone: (702) 455-7955.",
  "North Las Vegas": "File with North Las Vegas Justice Court. Constable: North Las Vegas Constable, 2332 Las Vegas Blvd N, North Las Vegas, NV 89030. Phone: (702) 455-7801.",
};

export class EvictionService {
  private twilio = new TwilioService();

  // ── Violations ──────────────────────────────────────────────

  async reportViolation(
    applicationId: string,
    violationType: string,
    description: string,
    occurredAt: string,
    reportedBy: string,
    reportedByRole: string,
    evidenceNotes?: string
  ): Promise<{ id: string }> {
    const app = await query(
      `SELECT a.id, a.property_id, a.first_name, a.last_name, a.phone
       FROM applications a WHERE a.id = $1`,
      [applicationId]
    );
    if (app.rows.length === 0) throw new Error("Application not found");

    const isMaterialBreach = MATERIAL_BREACH_TYPES.has(violationType);

    // VAWA pre-check: look for any DV-related flags or notes
    // In production this would check a dedicated VAWA registry
    const vawaFlagged = false; // Placeholder — would check VAWA table

    const result = await query(
      `INSERT INTO lease_violations
         (application_id, property_id, violation_type, description, occurred_at,
          reported_by, evidence_notes, is_material_breach, vawa_flagged)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        applicationId, app.rows[0].property_id, violationType, description,
        occurredAt, reportedBy, evidenceNotes || null, isMaterialBreach, vawaFlagged,
      ]
    );

    await writeAuditLog({
      action: "violation_reported",
      actorId: reportedBy,
      actorRole: reportedByRole,
      applicationId,
      resourceType: "lease_violation",
      resourceId: result.rows[0].id,
      details: { violationType, isMaterialBreach },
    });

    logger.info("Violation reported", { violationId: result.rows[0].id, violationType });
    return { id: result.rows[0].id };
  }

  async issueWarning(violationId: string, actorId: string, actorRole: string): Promise<void> {
    const viol = await query(
      `SELECT v.*, a.phone, a.first_name, a.last_name
       FROM lease_violations v JOIN applications a ON v.application_id = a.id
       WHERE v.id = $1`,
      [violationId]
    );
    if (viol.rows.length === 0) throw new Error("Violation not found");
    if (viol.rows[0].vawa_flagged) throw new Error("VAWA protection: eviction actions blocked for this tenant");

    await query(
      `UPDATE lease_violations SET status = 'warning_issued', warning_issued_at = NOW() WHERE id = $1`,
      [violationId]
    );

    await writeAuditLog({
      action: "violation_warning_issued",
      actorId, actorRole,
      applicationId: viol.rows[0].application_id,
      resourceType: "lease_violation",
      resourceId: violationId,
      details: { violationType: viol.rows[0].violation_type },
    });

    if (viol.rows[0].phone) {
      const name = `${viol.rows[0].first_name} ${viol.rows[0].last_name}`;
      this.twilio.sendSMS(viol.rows[0].phone,
        `${name}: You have received a warning for a lease violation. Please contact your property management office to discuss this matter.`
      ).catch(() => {});
    }
  }

  async generateNotice(
    violationId: string,
    noticeType: string,
    actorId: string,
    actorRole: string
  ): Promise<{ noticeId: string; noticeText: string }> {
    const viol = await query(
      `SELECT v.*, a.first_name, a.last_name, a.unit_number, a.phone,
              p.name as property_name, p.address_line1, p.city, p.state, p.zip,
              p.has_mortgage, p.compliance_period_start, p.compliance_period_end
       FROM lease_violations v
       JOIN applications a ON v.application_id = a.id
       JOIN properties p ON v.property_id = p.id
       WHERE v.id = $1`,
      [violationId]
    );
    if (viol.rows.length === 0) throw new Error("Violation not found");
    if (viol.rows[0].vawa_flagged) throw new Error("VAWA protection: eviction actions blocked for this tenant");

    const v = viol.rows[0];

    // CARES Act: if property has federal backing, force 30-day for nonpayment
    const caresApplicable = v.has_mortgage && ["pay_or_quit_7day"].includes(noticeType);
    const effectiveNoticeType = caresApplicable ? "nonpayment_cares_30day" : noticeType;

    // LIHTC good-cause filter: block "no cause" notices during compliance period
    if (["no_cause_7day", "no_cause_30day"].includes(noticeType)) {
      const now = new Date();
      const compStart = v.compliance_period_start ? new Date(v.compliance_period_start) : null;
      const compEnd = v.compliance_period_end ? new Date(v.compliance_period_end) : null;
      if (compStart && compEnd && now >= compStart && now <= compEnd) {
        throw new Error("LIHTC compliance: 'no cause' notices are blocked during the compliance period. Use a specific cause notice instead.");
      }
    }

    const noticeDays = NOTICE_PERIODS[effectiveNoticeType] || 7;
    const serveDate = new Date();
    const expirationDate = new Date(serveDate);
    expirationDate.setDate(expirationDate.getDate() + noticeDays);

    const tenantName = `${v.first_name} ${v.last_name}`;
    const propertyAddress = `${v.address_line1}, ${v.city}, ${v.state} ${v.zip}`;

    // Get amount owed from ledger for pay-or-quit notices
    let amountOwed = 0;
    if (effectiveNoticeType.includes("pay") || effectiveNoticeType.includes("nonpayment")) {
      const balResult = await query(
        `SELECT COALESCE(SUM(amount), 0) as balance FROM tenant_ledger
         WHERE application_id = $1 AND status = 'posted'`,
        [v.application_id]
      );
      amountOwed = Math.max(0, parseFloat(balResult.rows[0].balance));
    }

    const noticeText = this.buildNoticeText(effectiveNoticeType, tenantName, propertyAddress, v.unit_number, amountOwed, noticeDays, v.description);

    const result = await query(
      `INSERT INTO eviction_notices
         (application_id, violation_id, notice_type, tenant_name, property_address,
          unit_number, amount_owed, notice_text, serve_date, expiration_date, cares_act_applicable)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        v.application_id, violationId, effectiveNoticeType, tenantName, propertyAddress,
        v.unit_number, amountOwed, noticeText,
        serveDate.toISOString().split("T")[0],
        expirationDate.toISOString().split("T")[0],
        caresApplicable,
      ]
    );

    // Update violation status
    await query(
      `UPDATE lease_violations SET status = 'notice_served', notice_served_at = NOW(),
         cure_deadline = $2
       WHERE id = $1`,
      [violationId, expirationDate.toISOString().split("T")[0]]
    );

    await writeAuditLog({
      action: "eviction_notice_generated",
      actorId, actorRole,
      applicationId: v.application_id,
      resourceType: "eviction_notice",
      resourceId: result.rows[0].id,
      details: { noticeType: effectiveNoticeType, noticeDays, amountOwed, caresApplicable },
    });

    return { noticeId: result.rows[0].id, noticeText };
  }

  async serveNotice(noticeId: string, actorId: string, actorRole: string): Promise<void> {
    const notice = await query(
      `SELECT n.*, a.phone FROM eviction_notices n
       JOIN applications a ON n.application_id = a.id
       WHERE n.id = $1`,
      [noticeId]
    );
    if (notice.rows.length === 0) throw new Error("Notice not found");

    await query(
      `UPDATE eviction_notices SET status = 'served', served_by = $2, certificate_of_mailing = true
       WHERE id = $1`,
      [noticeId, actorId]
    );

    await writeAuditLog({
      action: "violation_notice_served",
      actorId, actorRole,
      applicationId: notice.rows[0].application_id,
      resourceType: "eviction_notice",
      resourceId: noticeId,
      details: { noticeType: notice.rows[0].notice_type },
    });

    if (notice.rows[0].phone) {
      this.twilio.sendSMS(notice.rows[0].phone,
        `${notice.rows[0].tenant_name}: A formal notice has been served regarding your tenancy. Please review the notice delivered to your unit and contact property management immediately.`
      ).catch(() => {});
    }
  }

  async resolveViolation(violationId: string, notes: string, actorId: string, actorRole: string): Promise<void> {
    const result = await query(
      `UPDATE lease_violations SET status = 'resolved', resolved_at = NOW(), resolved_by = $2, resolution_notes = $3
       WHERE id = $1 AND status NOT IN ('resolved', 'dismissed')
       RETURNING id, application_id`,
      [violationId, actorId, notes]
    );
    if (result.rows.length === 0) throw new Error("Violation not found or already resolved");

    await writeAuditLog({
      action: "violation_resolved",
      actorId, actorRole,
      applicationId: result.rows[0].application_id,
      resourceType: "lease_violation",
      resourceId: violationId,
      details: { notes },
    });
  }

  async dismissViolation(violationId: string, reason: string, actorId: string, actorRole: string): Promise<void> {
    const result = await query(
      `UPDATE lease_violations SET status = 'dismissed', resolved_at = NOW(), resolved_by = $2, resolution_notes = $3
       WHERE id = $1 AND status NOT IN ('resolved', 'dismissed')
       RETURNING id, application_id`,
      [violationId, actorId, reason]
    );
    if (result.rows.length === 0) throw new Error("Violation not found or already closed");

    await writeAuditLog({
      action: "violation_dismissed",
      actorId, actorRole,
      applicationId: result.rows[0].application_id,
      resourceType: "lease_violation",
      resourceId: violationId,
      details: { reason },
    });
  }

  // ── Eviction Cases ──────────────────────────────────────────

  async fileCase(
    noticeId: string,
    caseNumber: string,
    jurisdiction: string,
    actorId: string,
    actorRole: string
  ): Promise<{ id: string }> {
    const notice = await query(
      `SELECT n.application_id, a.property_id
       FROM eviction_notices n JOIN applications a ON n.application_id = a.id
       WHERE n.id = $1`,
      [noticeId]
    );
    if (notice.rows.length === 0) throw new Error("Notice not found");

    const constableInstr = CONSTABLE_INSTRUCTIONS[jurisdiction] || `File with ${jurisdiction} Justice Court.`;

    const result = await query(
      `INSERT INTO eviction_cases
         (application_id, property_id, notice_id, status, case_number, jurisdiction,
          filing_date, constable_instructions, created_by)
       VALUES ($1, $2, $3, 'filed', $4, $5, CURRENT_DATE, $6, $7)
       RETURNING id`,
      [
        notice.rows[0].application_id, notice.rows[0].property_id,
        noticeId, caseNumber, jurisdiction, constableInstr, actorId,
      ]
    );

    await writeAuditLog({
      action: "eviction_case_filed",
      actorId, actorRole,
      applicationId: notice.rows[0].application_id,
      resourceType: "eviction_case",
      resourceId: result.rows[0].id,
      details: { caseNumber, jurisdiction },
    });

    return { id: result.rows[0].id };
  }

  async updateCaseStatus(
    caseId: string,
    status: EvictionCaseStatus,
    details: { hearingDate?: string; judgmentDate?: string; judgmentAmount?: number; notes?: string },
    actorId: string,
    actorRole: string
  ): Promise<void> {
    // Look up current status to enforce state machine
    const current = await query(
      `SELECT status FROM eviction_cases WHERE id = $1`,
      [caseId]
    );
    if (current.rows.length === 0) throw new Error("Case not found");
    const fromStatus = current.rows[0].status as EvictionCaseStatus;

    if (fromStatus === status) {
      // No-op transition — still allow detail-only updates
    } else {
      const allowed = VALID_TRANSITIONS[fromStatus] || [];
      if (!allowed.includes(status)) {
        throw new Error(`Invalid status transition: ${fromStatus} -> ${status}`);
      }
    }

    const sets = [`status = $2`];
    const params: unknown[] = [caseId, status];

    if (details.hearingDate) { params.push(details.hearingDate); sets.push(`hearing_date = $${params.length}`); }
    if (details.judgmentDate) { params.push(details.judgmentDate); sets.push(`judgment_date = $${params.length}`); }
    if (details.judgmentAmount !== undefined) { params.push(details.judgmentAmount); sets.push(`judgment_amount = $${params.length}`); }
    if (details.notes) { params.push(details.notes); sets.push(`notes = $${params.length}`); }
    if (status === "writ_issued") sets.push(`writ_issued_date = CURRENT_DATE`);
    if (status === "executed") sets.push(`execution_date = CURRENT_DATE`);

    const result = await query(
      `UPDATE eviction_cases SET ${sets.join(", ")} WHERE id = $1 RETURNING application_id`,
      params
    );
    if (result.rows.length === 0) throw new Error("Case not found");

    await writeAuditLog({
      action: "eviction_case_updated",
      actorId, actorRole,
      applicationId: result.rows[0].application_id,
      resourceType: "eviction_case",
      resourceId: caseId,
      details: { from: fromStatus, to: status, ...details },
    });
  }

  // ── Queries ─────────────────────────────────────────────────

  async getViolations(filters: {
    status?: string; violationType?: string; propertyId?: string; applicationId?: string;
    limit?: number; offset?: number;
  } = {}, req?: AuthRequest): Promise<{ violations: any[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.status) { params.push(filters.status); conditions.push(`v.status = $${params.length}`); }
    if (filters.violationType) { params.push(filters.violationType); conditions.push(`v.violation_type = $${params.length}`); }
    if (filters.propertyId) { params.push(filters.propertyId); conditions.push(`v.property_id = $${params.length}`); }
    if (filters.applicationId) { params.push(filters.applicationId); conditions.push(`v.application_id = $${params.length}`); }

    if (req) {
      const scope = buildPropertyScope(req, params.length + 1, "v.property_id");
      if (scope.denyAll) return { violations: [], total: 0 };
      if (scope.sql) { conditions.push(scope.sql); params.push(scope.param); }
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countResult = await query(`SELECT COUNT(*) FROM lease_violations v ${where}`, params);
    const dataResult = await query(
      `SELECT v.*, a.first_name || ' ' || a.last_name as tenant_name, p.name as property_name
       FROM lease_violations v
       JOIN applications a ON v.application_id = a.id
       JOIN properties p ON v.property_id = p.id
       ${where}
       ORDER BY v.created_at DESC
       LIMIT ${filters.limit || 50} OFFSET ${filters.offset || 0}`,
      params
    );

    return { violations: dataResult.rows, total: parseInt(countResult.rows[0].count) };
  }

  async getViolationById(id: string, req?: AuthRequest): Promise<any> {
    const conditions = ["v.id = $1"];
    const params: unknown[] = [id];
    if (req) {
      const scope = buildPropertyScope(req, params.length + 1, "v.property_id");
      if (scope.denyAll) return null;
      if (scope.sql) { conditions.push(scope.sql); params.push(scope.param); }
    }
    const result = await query(
      `SELECT v.*, a.first_name || ' ' || a.last_name as tenant_name, p.name as property_name
       FROM lease_violations v
       JOIN applications a ON v.application_id = a.id
       JOIN properties p ON v.property_id = p.id
       WHERE ${conditions.join(" AND ")}`,
      params
    );
    return result.rows[0] || null;
  }

  async getNotices(filters: { applicationId?: string; status?: string } = {}, req?: AuthRequest): Promise<any[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filters.applicationId) { params.push(filters.applicationId); conditions.push(`n.application_id = $${params.length}`); }
    if (filters.status) { params.push(filters.status); conditions.push(`n.status = $${params.length}`); }

    if (req) {
      const scope = buildPropertyScope(req, params.length + 1, "a.property_id");
      if (scope.denyAll) return [];
      if (scope.sql) { conditions.push(scope.sql); params.push(scope.param); }
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await query(
      `SELECT n.* FROM eviction_notices n
       JOIN applications a ON n.application_id = a.id
       ${where} ORDER BY n.created_at DESC`,
      params
    );
    return result.rows;
  }

  async getNoticeById(id: string, req?: AuthRequest): Promise<any> {
    const conditions = ["n.id = $1"];
    const params: unknown[] = [id];
    if (req) {
      const scope = buildPropertyScope(req, params.length + 1, "a.property_id");
      if (scope.denyAll) return null;
      if (scope.sql) { conditions.push(scope.sql); params.push(scope.param); }
    }
    const result = await query(
      `SELECT n.* FROM eviction_notices n
       JOIN applications a ON n.application_id = a.id
       WHERE ${conditions.join(" AND ")}`,
      params
    );
    return result.rows[0] || null;
  }

  async getCases(filters: { status?: string; applicationId?: string } = {}, req?: AuthRequest): Promise<any[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filters.status) { params.push(filters.status); conditions.push(`c.status = $${params.length}`); }
    if (filters.applicationId) { params.push(filters.applicationId); conditions.push(`c.application_id = $${params.length}`); }

    if (req) {
      const scope = buildPropertyScope(req, params.length + 1, "c.property_id");
      if (scope.denyAll) return [];
      if (scope.sql) { conditions.push(scope.sql); params.push(scope.param); }
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await query(
      `SELECT c.*, a.first_name || ' ' || a.last_name as tenant_name, p.name as property_name
       FROM eviction_cases c
       JOIN applications a ON c.application_id = a.id
       JOIN properties p ON c.property_id = p.id
       ${where}
       ORDER BY c.created_at DESC`,
      params
    );
    return result.rows;
  }

  // ── Notice Templates ────────────────────────────────────────

  private buildNoticeText(
    noticeType: string, tenantName: string, propertyAddress: string,
    unitNumber: string | null, amountOwed: number, noticeDays: number, violationDesc: string
  ): string {
    const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const unit = unitNumber ? `, Unit ${unitNumber}` : "";

    const templates: Record<string, string> = {
      pay_or_quit_7day: [
        `SEVEN-DAY NOTICE TO PAY RENT OR QUIT`,
        `(NRS 40.253)`,
        ``,
        `Date: ${today}`,
        `To: ${tenantName}`,
        `Address: ${propertyAddress}${unit}`,
        ``,
        `You are hereby notified that you are in default in the payment of rent in the amount of $${amountOwed.toFixed(2)}.`,
        ``,
        `Within SEVEN (7) JUDICIAL DAYS after service of this notice, you are required to either:`,
        `  1. Pay the total amount due; OR`,
        `  2. Surrender possession of the premises.`,
        ``,
        `If you fail to do either, legal proceedings will be instituted against you to recover possession of the premises, rent, damages, and court costs.`,
        ``,
        `For information about court forms and filings, visit the Civil Law Self-Help Center at the Regional Justice Center, 200 Lewis Avenue, Las Vegas, NV 89101.`,
      ].join("\n"),

      nonpayment_cares_30day: [
        `THIRTY-DAY NOTICE TO PAY RENT OR QUIT`,
        `(CARES Act — Federally Backed Property)`,
        ``,
        `Date: ${today}`,
        `To: ${tenantName}`,
        `Address: ${propertyAddress}${unit}`,
        ``,
        `NOTICE: This property receives federal financial assistance. Under the CARES Act, you are entitled to a minimum 30-day notice period.`,
        ``,
        `You are in default in the payment of rent in the amount of $${amountOwed.toFixed(2)}.`,
        ``,
        `Within THIRTY (30) DAYS after service of this notice, you must either pay the total amount due or surrender possession.`,
      ].join("\n"),

      perform_or_quit_5day: [
        `FIVE-DAY NOTICE TO PERFORM LEASE CONDITION OR QUIT`,
        ``,
        `Date: ${today}`,
        `To: ${tenantName}`,
        `Address: ${propertyAddress}${unit}`,
        ``,
        `You are in violation of your lease agreement:`,
        `${violationDesc}`,
        ``,
        `Within FIVE (5) DAYS, you must cure this violation or surrender possession of the premises.`,
      ].join("\n"),

      nuisance_quit_3day: [
        `THREE-DAY NOTICE TO QUIT`,
        `(Nuisance, Waste, or Drug Violation — NRS 40.2514)`,
        ``,
        `Date: ${today}`,
        `To: ${tenantName}`,
        `Address: ${propertyAddress}${unit}`,
        ``,
        `You are hereby given THREE (3) DAYS to vacate the premises due to:`,
        `${violationDesc}`,
        ``,
        `This constitutes a material breach of your lease. No cure period is available for this type of violation.`,
      ].join("\n"),
    };

    // Default template for types without specific templates
    return templates[noticeType] || [
      `NOTICE TO TENANT`,
      `(${noticeType.replace(/_/g, " ").toUpperCase()})`,
      ``,
      `Date: ${today}`,
      `To: ${tenantName}`,
      `Address: ${propertyAddress}${unit}`,
      ``,
      `You are hereby notified that you must comply within ${noticeDays} day(s):`,
      `${violationDesc}`,
      ``,
      `Failure to comply may result in legal proceedings to recover possession of the premises.`,
    ].join("\n");
  }
}
