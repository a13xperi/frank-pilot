import { query } from "../../config/database";
import { writeAuditLog } from "../../middleware/audit";
import { logger } from "../../utils/logger";
import { TwilioService } from "../integrations/twilio";
// No import cycle: state-machine imports audit/logger/database/tape, never
// adverse-action. The finalizer below uses the same CAS chokepoint as the
// screening pipeline so the pending_adverse_action -> screening_failed move is
// exactly-once and gated on `changed`.
import { transitionApplicationStatus } from "../screening/state-machine";

/**
 * FCRA Adverse Action Notice Service
 *
 * Federal law (15 U.S.C. § 1681m) requires that when adverse action is taken
 * based in whole or in part on information from a consumer reporting agency (CRA),
 * the applicant must receive a notice that:
 *
 *   1. Names the CRA and provides its contact information
 *   2. States the CRA did not make the decision and cannot explain it
 *   3. Informs the applicant of their right to a free copy of their report within 60 days
 *   4. Informs the applicant of their right to dispute inaccurate information with the CRA
 *
 * A DB record is always written regardless of SMS delivery status.
 * SMS delivery is non-blocking — failure is logged but never propagated.
 *
 * Trigger points:
 *   - Automatically when ScreeningService.runFullScreening() returns 'fail'
 *   - Automatically when ApprovalService.tier*Review() decision is 'fail'
 *   - Manually via POST /api/applications/:id/adverse-action/resend
 */

// CRA details embedded in every adverse action notice (configurable via env)
const CRA_NAME = process.env.CRA_NAME || "Acme Background & Credit Services";
const CRA_ADDRESS = process.env.CRA_ADDRESS || "P.O. Box 1234, Las Vegas, NV 89101";
const CRA_PHONE = process.env.CRA_PHONE || "1-800-555-0199";
const PROPERTY_MGMT_CONTACT = process.env.PROPERTY_MGMT_CONTACT || "info@cdpc.nv.gov";

export interface AdverseActionResult {
  noticeId: string;
  applicationId: string;
  sentAt: Date;
  reason: string;
}

export class AdverseActionService {
  private twilio = new TwilioService();

  /**
   * Generate and send an FCRA-compliant adverse action notice.
   *
   * Fetches applicant details, builds the notice text, inserts a record into
   * adverse_action_notices, writes an audit log entry, and fires a non-blocking
   * SMS to the applicant's phone number.
   *
   * @param applicationId  The application being denied
   * @param actorId        Staff user triggering the notice (system or human)
   * @param actorRole      Role of the triggering actor
   * @param reason         Short code identifying why action was taken
   *                       e.g. 'screening_failed', 'tier1_denied', 'tier2_denied'
   * @param reasonDetail   Optional human-readable elaboration for the notice record
   */
  async sendNotice(
    applicationId: string,
    actorId: string | null,
    actorRole: string,
    reason: string,
    reasonDetail?: string
  ): Promise<AdverseActionResult> {
    // Fetch applicant contact info + property name for the notice
    const appResult = await query(
      `SELECT a.first_name, a.last_name, a.email, a.phone,
              p.name AS property_name
       FROM applications a
       JOIN properties p ON a.property_id = p.id
       WHERE a.id = $1`,
      [applicationId]
    );

    if (appResult.rows.length === 0) {
      throw new Error(`Application not found: ${applicationId}`);
    }

    const app = appResult.rows[0];
    const applicantName = `${app.first_name} ${app.last_name}`;

    const noticeText = this.buildNoticeText(
      applicantName,
      app.property_name,
      reasonDetail
    );

    // Insert notice record — always persisted regardless of SMS outcome
    const insertResult = await query(
      `INSERT INTO adverse_action_notices
         (application_id, sent_by, reason, reason_detail, notice_text, sent_via)
       VALUES ($1, $2, $3, $4, $5, 'sms')
       RETURNING id, created_at`,
      [applicationId, actorId, reason, reasonDetail || null, noticeText]
    );

    const { id: noticeId, created_at: sentAt } = insertResult.rows[0];

    await writeAuditLog({
      action: "adverse_action_notice_sent",
      // actorId may be null when the daily finalizer (system, no UUID) sends the
      // § 1681m final notice — sent_by/actor_id are nullable FKs; coerce to
      // undefined so writeAuditLog's `entry.actorId || null` types check.
      actorId: actorId ?? undefined,
      actorRole,
      applicationId,
      resourceType: "adverse_action_notice",
      resourceId: noticeId,
      details: {
        reason,
        reasonDetail: reasonDetail || null,
        noticeId,
        sentVia: "sms",
        applicantName,
      },
    });

    // Send SMS — non-blocking; DB record is the authoritative evidence of notice
    if (app.phone) {
      this.twilio
        .notifyDenied(app.phone, applicantName)
        .catch((err: Error) =>
          logger.warn("Adverse action SMS notification failed", {
            error: err.message,
            applicationId,
            noticeId,
          })
        );
    } else {
      logger.warn("Adverse action notice: applicant has no phone number on file", {
        applicationId,
        noticeId,
      });
    }

    logger.info("Adverse action notice sent", { applicationId, noticeId, reason });

    return { noticeId, applicationId, sentAt, reason };
  }

  /**
   * Render an FCRA § 1681m adverse-action notice WITHOUT committing or sending
   * it. Lets staff preview the exact denial text before they resolve a held
   * application into screening_failed (which is the single send path —
   * sendNotice — used on resolve).
   *
   * Performs the SAME applicant-name + property-name lookups as sendNotice and
   * calls the SAME buildNoticeText, so the preview is byte-identical to what
   * sendNotice would persist for the same reasonDetail. It MUST NOT insert into
   * adverse_action_notices and MUST NOT fire any SMS — it is a pure render.
   *
   * @param applicationId  The application a denial is being previewed for
   * @param reasonDetail   Optional human-readable elaboration for the notice
   */
  async generateNoticeDraft(
    applicationId: string,
    reasonDetail?: string
  ): Promise<{
    applicationId: string;
    applicantName: string;
    propertyName: string;
    noticeText: string;
  }> {
    // Identical lookup to sendNotice — applicant name + property name only.
    const appResult = await query(
      `SELECT a.first_name, a.last_name, a.email, a.phone,
              p.name AS property_name
       FROM applications a
       JOIN properties p ON a.property_id = p.id
       WHERE a.id = $1`,
      [applicationId]
    );

    if (appResult.rows.length === 0) {
      throw new Error(`Application not found: ${applicationId}`);
    }

    const app = appResult.rows[0];
    const applicantName = `${app.first_name} ${app.last_name}`;

    const noticeText = this.buildNoticeText(
      applicantName,
      app.property_name,
      reasonDetail
    );

    // Pure render: no INSERT into adverse_action_notices, no SMS, no audit log.
    return {
      applicationId,
      applicantName,
      propertyName: app.property_name,
      noticeText,
    };
  }

  /**
   * Retrieve the most recently sent adverse action notice for an application.
   * Returns null if no notice has been sent yet.
   */
  async getNotice(applicationId: string): Promise<{
    noticeId: string;
    applicationId: string;
    reason: string;
    reasonDetail: string | null;
    sentAt: Date;
    sentVia: string;
  } | null> {
    const result = await query(
      `SELECT id, application_id, reason, reason_detail, sent_via, created_at
       FROM adverse_action_notices
       WHERE application_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [applicationId]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      noticeId: row.id,
      applicationId: row.application_id,
      reason: row.reason,
      reasonDetail: row.reason_detail || null,
      sentAt: row.created_at,
      sentVia: row.sent_via,
    };
  }

  /**
   * Build the full FCRA-compliant adverse action notice text.
   * Intentionally does not include SSN, DOB, or other sensitive PII.
   */
  private buildNoticeText(
    applicantName: string,
    propertyName: string,
    reasonDetail?: string
  ): string {
    const today = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    return [
      `Date: ${today}`,
      ``,
      `Dear ${applicantName},`,
      ``,
      `We regret to inform you that your rental application for ${propertyName} has been denied.`,
      reasonDetail ? `\nReason: ${reasonDetail}` : "",
      ``,
      `This decision was based in whole or in part on information obtained from a consumer`,
      `reporting agency (CRA):`,
      ``,
      `  ${CRA_NAME}`,
      `  ${CRA_ADDRESS}`,
      `  Phone: ${CRA_PHONE}`,
      ``,
      `Under the Fair Credit Reporting Act (FCRA), 15 U.S.C. § 1681m, you have the right to:`,
      ``,
      `  1. Obtain a FREE copy of your consumer report from the CRA listed above`,
      `     within 60 days of receiving this notice.`,
      ``,
      `  2. Dispute any inaccurate or incomplete information directly with the CRA.`,
      ``,
      `The CRA listed above did not make this adverse action decision and is unable to`,
      `explain why the decision was made.`,
      ``,
      `For questions regarding your application, please contact us at:`,
      `  ${PROPERTY_MGMT_CONTACT}`,
      ``,
      `Community Development Programs Center of Nevada`,
    ]
      .join("\n")
      .replace(/\n{3,}/g, "\n\n"); // collapse any triple+ newlines from empty reasonDetail
  }

  // -------------------------------------------------------------------------
  // Pre-adverse-action window (flag-gated FCRA_PRE_ADVERSE_ENABLED)
  //
  // Legal framing (do not overstate): FCRA § 1681b(b)(3) — the pre-adverse
  // subsection — governs EMPLOYMENT screening, not rental. A landlord's federal
  // duty is the § 1681m POST-action notice (sendNotice above). The pre-adverse
  // notice + dispute window below is a configurable best-practice / HUD-aligned /
  // state-law-ready courtesy, default OFF. The notice text says we *intend* to
  // deny and gives the applicant time to obtain and dispute their report; it
  // never claims a federal rental mandate.
  // -------------------------------------------------------------------------

  /**
   * Send a PRE-adverse notice: intent-to-deny + copy-of-report/dispute rights +
   * an N-business-day window (until eligibleDate). Persists a stage='pre_adverse'
   * row in adverse_action_notices; the daily finalizer later carries this row's
   * reason_detail into the final § 1681m notice so preview === sent across the
   * whole window. Same applicant/property lookup + non-blocking SMS as sendNotice.
   */
  async sendPreAdverseNotice(
    applicationId: string,
    actorId: string | null,
    actorRole: string,
    reason: string,
    windowDays: number,
    eligibleDate: Date,
    reasonDetail?: string
  ): Promise<AdverseActionResult> {
    const appResult = await query(
      `SELECT a.first_name, a.last_name, a.email, a.phone,
              p.name AS property_name
       FROM applications a
       JOIN properties p ON a.property_id = p.id
       WHERE a.id = $1`,
      [applicationId]
    );

    if (appResult.rows.length === 0) {
      throw new Error(`Application not found: ${applicationId}`);
    }

    const app = appResult.rows[0];
    const applicantName = `${app.first_name} ${app.last_name}`;

    const noticeText = this.buildPreAdverseNoticeText(
      applicantName,
      app.property_name,
      windowDays,
      eligibleDate,
      reasonDetail
    );

    const insertResult = await query(
      `INSERT INTO adverse_action_notices
         (application_id, sent_by, reason, reason_detail, notice_text, sent_via, stage)
       VALUES ($1, $2, $3, $4, $5, 'sms', 'pre_adverse')
       RETURNING id, created_at`,
      [applicationId, actorId, reason, reasonDetail || null, noticeText]
    );

    const { id: noticeId, created_at: sentAt } = insertResult.rows[0];

    await writeAuditLog({
      action: "pre_adverse_action_notice_sent",
      actorId: actorId ?? undefined,
      actorRole,
      applicationId,
      resourceType: "adverse_action_notice",
      resourceId: noticeId,
      details: {
        reason,
        reasonDetail: reasonDetail || null,
        noticeId,
        stage: "pre_adverse",
        windowDays,
        eligibleAt: eligibleDate.toISOString(),
        sentVia: "sms",
        applicantName,
      },
    });

    if (app.phone) {
      this.twilio
        .notifyDenied(app.phone, applicantName)
        .catch((err: Error) =>
          logger.warn("Pre-adverse action SMS notification failed", {
            error: err.message,
            applicationId,
            noticeId,
          })
        );
    } else {
      logger.warn("Pre-adverse action notice: applicant has no phone number on file", {
        applicationId,
        noticeId,
      });
    }

    logger.info("Pre-adverse action notice sent", {
      applicationId,
      noticeId,
      reason,
      windowDays,
      eligibleAt: eligibleDate.toISOString(),
    });

    return { noticeId, applicationId, sentAt, reason };
  }

  /**
   * Finalize every pre-adverse hold whose dispute window has elapsed: each due
   * application is CAS-moved pending_adverse_action -> screening_failed
   * (adverse_action_finalized, system actor) and — gated on the CAS winning —
   * sent the final § 1681m notice carrying the stored pre_adverse reason_detail
   * (preview === sent). Side effects are gated on the CAS result, not the SELECT,
   * so overlapping scheduler runs / multiple instances finalize exactly once.
   * Errors are caught per row so one bad application never stalls the sweep.
   */
  async finalizeDuePreAdverseActions(): Promise<{
    scanned: number;
    finalized: number;
    noticesSent: number;
  }> {
    const due = await query(
      `SELECT a.id,
              (SELECT n.reason_detail
                 FROM adverse_action_notices n
                WHERE n.application_id = a.id AND n.stage = 'pre_adverse'
                ORDER BY n.created_at DESC
                LIMIT 1) AS pre_adverse_reason_detail
         FROM applications a
        WHERE a.status = 'pending_adverse_action'
          AND a.adverse_action_eligible_at IS NOT NULL
          AND a.adverse_action_eligible_at <= NOW()
        ORDER BY a.adverse_action_eligible_at ASC`
    );

    let finalized = 0;
    let noticesSent = 0;

    for (const row of due.rows) {
      const applicationId = row.id as string;
      const reasonDetail = (row.pre_adverse_reason_detail as string | null) || undefined;

      try {
        // System actor: actorId undefined -> NULL in status_history + audit
        // (actor_id is a nullable UUID FK; "system" is a non-UUID string and
        // would violate the FK). actorRole carries the "system" attribution.
        const { changed } = await transitionApplicationStatus({
          applicationId,
          from: "pending_adverse_action",
          to: "screening_failed",
          trigger: "adverse_action_finalized",
          actorId: undefined,
          actorRole: "system",
          evidence: { finalizedBy: "pre_adverse_window_scheduler" },
        });

        if (!changed) continue; // lost the CAS — another run already finalized
        finalized++;

        // Final § 1681m notice — reuses the stored pre_adverse reason_detail so
        // the applicant gets the exact denial reason they were forewarned of.
        await this.sendNotice(
          applicationId,
          null,
          "system",
          "screening_failed",
          reasonDetail
        );
        noticesSent++;
      } catch (err) {
        logger.error("Pre-adverse finalization failed for application", {
          error: (err as Error).message,
          applicationId,
        });
      }
    }

    return { scanned: due.rows.length, finalized, noticesSent };
  }

  /**
   * Build the PRE-adverse notice text — intent-to-deny + dispute window. Mirrors
   * buildNoticeText's structure (CRA block, FCRA rights, collapse triple
   * newlines) but frames the decision as not-yet-final and gives a deadline.
   * Intentionally excludes SSN/DOB/PII.
   */
  private buildPreAdverseNoticeText(
    applicantName: string,
    propertyName: string,
    windowDays: number,
    eligibleDate: Date,
    reasonDetail?: string
  ): string {
    const today = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const deadline = eligibleDate.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    return [
      `Date: ${today}`,
      ``,
      `Dear ${applicantName},`,
      ``,
      `We are writing to inform you that we INTEND to deny your rental application`,
      `for ${propertyName}. This decision is not yet final.`,
      reasonDetail ? `\nReason under consideration: ${reasonDetail}` : "",
      ``,
      `This intended decision is based in whole or in part on information obtained`,
      `from a consumer reporting agency (CRA):`,
      ``,
      `  ${CRA_NAME}`,
      `  ${CRA_ADDRESS}`,
      `  Phone: ${CRA_PHONE}`,
      ``,
      `Before we finalize this decision, you have ${windowDays} business days`,
      `(until ${deadline}) to:`,
      ``,
      `  1. Obtain a FREE copy of your consumer report from the CRA listed above.`,
      ``,
      `  2. Dispute any inaccurate or incomplete information directly with the CRA,`,
      `     and let us know you are disputing it.`,
      ``,
      `The CRA listed above did not make this intended decision and is unable to`,
      `explain why it was made. If we do not hear from you within the window above,`,
      `the decision may become final and you will receive a final notice.`,
      ``,
      `For questions regarding your application, please contact us at:`,
      `  ${PROPERTY_MGMT_CONTACT}`,
      ``,
      `Community Development Programs Center of Nevada`,
    ]
      .join("\n")
      .replace(/\n{3,}/g, "\n\n"); // collapse any triple+ newlines from empty reasonDetail
  }
}
