import { query } from "../../config/database";
import { logger } from "../../utils/logger";
import { stepSms, type SmsStep } from "./state-machine";

/**
 * Inbound-SMS intake service (Phase 1, phone-first Frank).
 *
 * `handleInbound` is the single entrypoint the Twilio inbound route calls. It:
 *   1. loads (or creates) the in-flight `sms_sessions` row for the From number,
 *   2. runs the pure state machine against the inbound body,
 *   3. persists the new step + accumulated answers,
 *   4. on `done`, promotes the conversation into an `applications` draft
 *      (source 'sms') and back-references it on the session,
 *   5. returns the reply string the route wraps in TwiML.
 *
 * FAIL-CLOSED: every path is dark unless SMS_INTAKE_ENABLED === "true". When
 * the flag is off we throw a typed error the route maps to a 503 — no session
 * is created, no draft is inserted, nothing is persisted.
 */

export class SmsIntakeDisabledError extends Error {
  readonly code = "SMS_INTAKE_DISABLED";
  constructor() {
    super("SMS intake disabled");
    this.name = "SmsIntakeDisabledError";
  }
}

function isEnabled(): boolean {
  return process.env.SMS_INTAKE_ENABLED === "true";
}

interface SessionRow {
  id: string;
  phone_e164: string;
  application_id: string | null;
  step: SmsStep;
  collected: Record<string, string>;
}

/**
 * Load the latest active session for a phone, or create a fresh one at the
 * `start` step. Sessions are keyed by phone; a completed/abandoned thread is
 * left in place and a new `active` row begins the next conversation.
 */
async function loadOrCreateSession(phoneE164: string): Promise<SessionRow> {
  const existing = await query(
    `SELECT id, phone_e164, application_id, step, collected
       FROM sms_sessions
      WHERE phone_e164 = $1 AND status = 'active'
      ORDER BY created_at DESC
      LIMIT 1`,
    [phoneE164]
  );
  const row = existing.rows[0];
  if (row) {
    return {
      id: row.id as string,
      phone_e164: row.phone_e164 as string,
      application_id: (row.application_id as string | null) ?? null,
      step: row.step as SmsStep,
      collected: (row.collected as Record<string, string>) ?? {},
    };
  }

  const created = await query(
    `INSERT INTO sms_sessions (phone_e164)
     VALUES ($1)
     RETURNING id, phone_e164, application_id, step, collected`,
    [phoneE164]
  );
  const fresh = created.rows[0];
  return {
    id: fresh.id as string,
    phone_e164: fresh.phone_e164 as string,
    application_id: (fresh.application_id as string | null) ?? null,
    step: fresh.step as SmsStep,
    collected: (fresh.collected as Record<string, string>) ?? {},
  };
}

/**
 * Insert an `applications` draft from the collected answers (source 'sms').
 *
 * `applications.property_id` is NOT NULL with an FK to properties — the SMS
 * flow never collects a property, so we route the draft to a configured
 * landing property (SMS_INTAKE_DEFAULT_PROPERTY_ID). If that is unset we skip
 * the insert (logged), still completing the conversation: the applicant's
 * answers stay on the session row for manual triage, and we never crash the
 * inbound webhook over a config gap (fail-closed).
 *
 * Income is stored verbatim like the voice path — no AMI math here.
 */
async function promoteToDraft(
  session: SessionRow,
  collected: Record<string, string>
): Promise<string | null> {
  const propertyId = process.env.SMS_INTAKE_DEFAULT_PROPERTY_ID;
  if (!propertyId) {
    logger.warn("SMS intake complete but SMS_INTAKE_DEFAULT_PROPERTY_ID unset — draft skipped", {
      sessionId: session.id,
    });
    return null;
  }

  const name = (collected.name ?? "").trim() || "Unknown Texter";
  const [firstName, ...rest] = name.split(/\s+/);
  const lastName = rest.join(" ") || "—";

  const householdRaw = collected.household;
  const householdSize = householdRaw ? parseInt(householdRaw, 10) || null : null;
  const incomeRaw = collected.monthly_income;
  const monthlyIncome = incomeRaw ? Number(incomeRaw.replace(/[^0-9.]/g, "")) : null;
  const annualIncome = monthlyIncome ? monthlyIncome * 12 : null;
  const currentCity = (collected.current_city ?? "").trim() || null;

  const inserted = await query(
    `INSERT INTO applications (
       property_id, first_name, last_name, phone, current_city,
       household_size, annual_income, status, source
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft', 'sms')
     RETURNING id`,
    [
      propertyId,
      firstName ?? "Unknown",
      lastName,
      session.phone_e164,
      currentCity,
      householdSize,
      annualIncome,
    ]
  );
  return (inserted.rows[0]?.id as string) ?? null;
}

/**
 * Handle one inbound SMS. Returns the reply body the route renders as TwiML.
 *
 * @param fromPhone the Twilio `From` number (E.164)
 * @param body      the Twilio `Body` (inbound text)
 */
export async function handleInbound(fromPhone: string, body: string): Promise<string> {
  if (!isEnabled()) throw new SmsIntakeDisabledError();

  const phoneE164 = (fromPhone ?? "").trim();
  const session = await loadOrCreateSession(phoneE164);

  const result = stepSms(session.step, session.collected, body ?? "");

  // On completion, promote to a draft before flipping the session so the
  // back-reference and status land together.
  let applicationId = session.application_id;
  let status: "active" | "completed" = "active";
  if (result.done) {
    try {
      const draftId = await promoteToDraft(session, result.collected);
      if (draftId) applicationId = draftId;
    } catch (err) {
      // Never crash the inbound webhook over a draft-insert failure — log and
      // still complete the conversation (answers persisted on the session).
      logger.error("SMS intake draft insert failed", {
        sessionId: session.id,
        error: (err as Error).message,
      });
    }
    status = "completed";
  }

  await query(
    `UPDATE sms_sessions
        SET step = $2,
            collected = $3::jsonb,
            status = $4,
            application_id = $5,
            updated_at = now()
      WHERE id = $1`,
    [session.id, result.nextStep, JSON.stringify(result.collected), status, applicationId]
  );

  return result.reply;
}
