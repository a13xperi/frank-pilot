/**
 * Shared post-payment core for a paid $35.95 application fee.
 *
 * Both money paths converge here so they run byte-for-byte the same downstream
 * work:
 *   - the email link  → Stripe Checkout → `payment_intent.succeeded` webhook
 *     (handleApplicationFeeSucceeded, webhook.ts), and
 *   - the on-call DTMF → Twilio `<Pay>` → Stripe Pay Connector → /api/pay/result
 *     action callback (pay-phone/routes.ts).
 *
 * The work: post the fee to the ledger, then — gated on a recorded FCRA
 * authorization (consent ON FILE) AND a real submitter — flip draft → submitted
 * and fire the full screening pipeline. No consent → no pull; the application
 * just waits. Tape + audit are stamped regardless.
 *
 * Idempotency: recordPayment does NOT dedupe on reference_id (it inserts a fresh
 * ledger row each call). The webhook leg is fenced upstream by
 * stripe_processed_events + payment_idempotency, so it passes dedupeOnRef:false
 * to stay byte-for-byte identical to its prior inline body. The DTMF leg has no
 * such fence — Twilio can re-POST the `<Pay>` action callback — so it passes
 * dedupeOnRef:true to guard against a double-post.
 */
import { query } from "../../config/database";
import { writeAuditLog } from "../../middleware/audit";
import { logger } from "../../utils/logger";
import { stampTape } from "../tape";
import { LedgerService } from "../ledger/service";
import { hasValidAuthorization } from "../screening/consumer-report-consent";
import { ScreeningService } from "../screening/service";
import { recordLedgerEntry } from "../relationship/ledger";

const ledgerService = new LedgerService();

export interface ApplyApplicationFeeParams {
  /** The application the fee is for. */
  applicationId: string;
  /** Dollar amount paid (e.g. 35.95). */
  amountDollars: number;
  /** Charge reference: the Stripe PaymentIntent id (link) or Twilio PaymentConfirmationCode (DTMF). */
  chargeRef: string;
  /** Actor label used on tape + audit (e.g. "stripe-webhook", "twilio-pay"). */
  source: string;
  /** Tape sessionId. Defaults to chargeRef. */
  sessionId?: string;
  /** Fallback submitter UUID when applications.submitted_by is null (webhook passes md.actorId). */
  actorIdFallback?: string;
  /** Ledger note. Defaults to "Application fee — <chargeRef>". */
  notes?: string;
  /** Guard repeated callbacks by short-circuiting if a payment row already exists for chargeRef. */
  dedupeOnRef?: boolean;
}

export interface ApplyApplicationFeeResult {
  ledgerEntryId: string | null;
  screeningFired: boolean;
  /** True when dedupeOnRef short-circuited because the fee was already applied. */
  deduped: boolean;
}

export async function applyApplicationFeePaid(
  params: ApplyApplicationFeeParams
): Promise<ApplyApplicationFeeResult> {
  const {
    applicationId,
    amountDollars,
    chargeRef,
    source,
    actorIdFallback,
    dedupeOnRef = false,
  } = params;
  const sessionId = params.sessionId ?? chargeRef;
  const notes = params.notes ?? `Application fee — ${chargeRef}`;
  const amountCents = Math.round(amountDollars * 100);

  // DTMF guard: Twilio can re-POST the action callback and recordPayment does
  // not dedupe, so a repeat would double-post the ledger. Webhook passes false
  // (fenced upstream) to preserve its exact prior behavior.
  if (dedupeOnRef) {
    const existing = await query(
      `SELECT id FROM tenant_ledger
        WHERE application_id = $1 AND reference_id = $2 AND entry_type = 'payment'
        LIMIT 1`,
      [applicationId, chargeRef]
    );
    if (existing.rows.length > 0) {
      logger.info("application fee already applied; skipping", {
        applicationId,
        chargeRef,
        source,
      });
      return {
        ledgerEntryId: (existing.rows[0]?.id as string) ?? null,
        screeningFired: false,
        deduped: true,
      };
    }
  }

  const ledgerEntry = await ledgerService.recordPayment(
    applicationId,
    amountDollars,
    chargeRef,
    null,
    null,
    notes
  );

  // FCRA + fee gate: only run screening when consent is on file. The actor is
  // the applicant who submitted; screening needs a real actor id.
  const consented = await hasValidAuthorization(applicationId);
  const actorRes = await query(
    `SELECT submitted_by, status, phone FROM applications WHERE id = $1`,
    [applicationId]
  );
  const submittedBy =
    (actorRes.rows[0]?.submitted_by as string) ?? actorIdFallback ?? "";
  const applicantPhone = (actorRes.rows[0]?.phone as string) ?? null;

  void recordLedgerEntry({
    phoneE164: applicantPhone,
    eventType: "fee_paid",
    summary: "Paid the $35.95 verification fee",
    ref: applicationId,
  });

  let screeningFired = false;
  if (consented && submittedBy) {
    screeningFired = true;
    void recordLedgerEntry({
      phoneE164: applicantPhone,
      eventType: "screening_started",
      summary: "Identity, credit, and background check started",
      ref: applicationId,
    });
    // Fire-and-forget: a slow/failed pull must not 500 the caller (Stripe would
    // retry and double-post the ledger; Twilio would replay the callback).
    void (async () => {
      try {
        // Paying the fee submits the application. Flip draft → submitted
        // (idempotent — only touches a draft) so runFullScreening, which
        // requires submitted/screening, can run.
        await query(
          `UPDATE applications
              SET status = 'submitted',
                  submitted_at = COALESCE(submitted_at, NOW()),
                  submitted_by = COALESCE(submitted_by, $2)
            WHERE id = $1 AND status = 'draft'`,
          [applicationId, submittedBy]
        );
        await new ScreeningService().runFullScreening(
          applicationId,
          submittedBy,
          "applicant"
        );
      } catch (err) {
        logger.error("post-fee screening failed", {
          applicationId,
          chargeRef,
          source,
          error: (err as Error).message,
        });
      }
    })();
  } else {
    logger.warn("application_fee paid but screening held", {
      applicationId,
      chargeRef,
      source,
      consented,
      hasActor: Boolean(submittedBy),
    });
  }

  void stampTape({
    kind: "BP08_PAYMENT_SUCCEEDED",
    actor: source,
    sessionId,
    payload: {
      feeType: "application_fee",
      applicationId,
      paymentIntentId: chargeRef,
      amountCents,
      ledgerEntryId: ledgerEntry.id,
      screeningFired,
    },
  });

  await writeAuditLog({
    action: "application_fee_succeeded",
    applicationId,
    resourceType: "payment_intent",
    details: {
      actor: source,
      amountCents,
      paymentIntentId: chargeRef,
      ledgerEntryId: ledgerEntry.id,
      screeningFired,
    },
  });

  return { ledgerEntryId: ledgerEntry.id, screeningFired, deduped: false };
}
