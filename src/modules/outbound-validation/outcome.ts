import { query } from "../../config/database";
import { logger } from "../../utils/logger";
import { stampTape } from "../tape";
import { pickField, type PostCallPayload } from "../voice-intake/service";
import { recordCallOutcome, getApplicantPhone, type GpmOutcome } from "./sage-client";
import { createMagicLinkByUserId, sendMagicLinkSms } from "../auth/magic-link-service";

/**
 * Post-call webhook -> Sage outcome mapping for outbound validation calls.
 *
 * The voice-intake webhook receiver (signature verification, idempotency,
 * DLQ) stays the single front door; its dispatch() hands events whose
 * agent_id matches the outbound validation agent to handleOutboundPostCall
 * instead of persisting them as intakes.
 */

export interface MappedOutcome {
  outcome: GpmOutcome;
  stillInterested: boolean | null;
  notes: string;
}

export function isOutboundValidationEvent(payload: PostCallPayload): boolean {
  const outboundAgentId = process.env.ELEVENLABS_OUTBOUND_AGENT_ID ?? "";
  return Boolean(outboundAgentId) && payload.agent_id === outboundAgentId;
}

/**
 * data_collection_results values arrive as {value, rationale, ...} entries;
 * booleans may be real booleans or "true"/"false" strings depending on the
 * agent's schema. Read both shapes.
 */
function readBool(
  results: Record<string, unknown> | undefined,
  key: string
): boolean | null {
  if (!results) return null;
  const entry = results[key];
  if (!entry || typeof entry !== "object") return null;
  const value = (entry as { value?: unknown }).value;
  if (typeof value === "boolean") return value;
  if (typeof value === "string" && value.trim()) {
    if (/^(true|yes|1|y)$/i.test(value.trim())) return true;
    if (/^(false|no|0|n)$/i.test(value.trim())) return false;
  }
  return null;
}

function hasUserTurns(payload: PostCallPayload): boolean {
  return (payload.transcript ?? []).some(
    (t) => t.role === "user" && Boolean(t.message?.trim())
  );
}

export function mapPostCallToOutcome(payload: PostCallPayload): MappedOutcome {
  const data = payload.analysis?.data_collection_results;
  const durationSecs = payload.metadata?.call_duration_secs ?? null;

  const summaryParts: string[] = [];
  const summary = pickField(data, "call_summary");
  if (summary) summaryParts.push(summary);
  const aptConfirmed = pickField(data, "apt_type_confirmed");
  if (aptConfirmed) summaryParts.push(`apt: ${aptConfirmed}`);
  const dateConfirmed = pickField(data, "date_needed_confirmed");
  if (dateConfirmed) summaryParts.push(`needed: ${dateConfirmed}`);
  const newPhone = pickField(data, "new_phone_number");
  if (newPhone) summaryParts.push(`new phone: ${newPhone}`);
  summaryParts.push(`conv:${payload.conversation_id}`);
  const notes = summaryParts.join(" | ").slice(0, 1000);

  const stillInterested = readBool(data, "still_interested");

  // Precedence: hard signals first, then the answer we came for.
  if (readBool(data, "wrong_number") === true) {
    return { outcome: "bad_number", stillInterested: null, notes };
  }
  if (readBool(data, "reached_voicemail") === true) {
    return { outcome: "voicemail", stillInterested: null, notes };
  }
  const tooShort = durationSecs != null && durationSecs < 5;
  const failed = (payload.status ?? "").toLowerCase() === "failed";
  if (failed || tooShort || !hasUserTurns(payload)) {
    return { outcome: "no_answer", stillInterested: null, notes };
  }
  if (readBool(data, "wants_callback") === true) {
    return { outcome: "callback_requested", stillInterested, notes };
  }
  if (stillInterested === true) {
    return { outcome: "confirmed", stillInterested: true, notes };
  }
  if (stillInterested === false) {
    return { outcome: "declined", stillInterested: false, notes };
  }
  // Spoke to someone but never established interest — count the attempt and
  // let the retry machine take another swing.
  return {
    outcome: "no_answer",
    stillInterested: null,
    notes: `unmapped result | ${notes}`.slice(0, 1000),
  };
}

interface LocalCallRow {
  id: string;
  applicant_id: string;
  status: string;
  test_call: boolean;
}

async function findLocalCall(payload: PostCallPayload): Promise<LocalCallRow | null> {
  const byConversation = await query(
    `SELECT id, applicant_id, status, test_call
       FROM outbound_validation_calls
      WHERE conversation_id = $1
      LIMIT 1`,
    [payload.conversation_id]
  );
  if (byConversation.rows.length > 0) return byConversation.rows[0] as LocalCallRow;

  // Fallback: ElevenLabs echoes conversation_initiation_client_data back on
  // the post-call payload; applicant_id rides in dynamic_variables.
  const echoed = (payload as unknown as {
    conversation_initiation_client_data?: { dynamic_variables?: Record<string, unknown> };
  }).conversation_initiation_client_data?.dynamic_variables?.applicant_id;
  if (typeof echoed === "string" && echoed) {
    const byApplicant = await query(
      `SELECT id, applicant_id, status, test_call
         FROM outbound_validation_calls
        WHERE applicant_id = $1 AND status = 'dialed'
        ORDER BY dialed_at DESC
        LIMIT 1`,
      [echoed]
    );
    if (byApplicant.rows.length > 0) return byApplicant.rows[0] as LocalCallRow;
  }
  return null;
}

/**
 * Find an active applicant/tenant by phone, else create one with an internal
 * synthetic email (email is never a user-facing touch on the outbound golden path
 * — SMS is). Best-effort: returns a user id or null, never throws into the webhook.
 */
async function findOrCreateUserByPhone(
  phoneE164: string,
  conversationId: string
): Promise<string | null> {
  try {
    const existing = await query(
      `SELECT id FROM users
        WHERE phone = $1 AND role IN ('applicant', 'tenant') AND is_active = TRUE
        ORDER BY created_at DESC LIMIT 1`,
      [phoneE164]
    );
    if (existing.rows[0]?.id) return existing.rows[0].id as string;

    const digits = phoneE164.replace(/[^0-9]/g, "");
    const email = `voice+${digits}@voice-handoff.invalid`; // RFC 2606 .invalid — never receives mail
    const inserted = await query(
      `INSERT INTO users (email, first_name, last_name, phone, role, is_active, password_hash)
       VALUES ($1, 'Voice', 'Caller', $2, 'applicant', TRUE, '')
       ON CONFLICT (email) DO UPDATE SET phone = EXCLUDED.phone
       RETURNING id`,
      [email, phoneE164]
    );
    return (inserted.rows[0]?.id as string) ?? null;
  } catch (err) {
    logger.error("Outbound app-link: user create failed", {
      conversationId,
      error: (err as Error).message,
    });
    return null;
  }
}

/**
 * The send_app_link text handoff: text a magic link so a CONFIRMED outbound call
 * launches the same call→text→walkthrough chain as inbound. The phone is fetched
 * fresh from Sage (source of truth) by applicant id — we never persist the full
 * number on the local call row (it stores only last-4). Best-effort end to end;
 * a text failure must never affect the already-recorded call outcome.
 */
async function sendOutboundAppLink(applicantId: string, conversationId: string): Promise<void> {
  try {
    const phone = await getApplicantPhone(applicantId);
    if (!phone) {
      logger.warn("Outbound app-link: no phone on the Sage applicant", { conversationId, applicantId });
      return;
    }
    const userId = await findOrCreateUserByPhone(phone, conversationId);
    if (!userId) return;
    const magic = await createMagicLinkByUserId(userId);
    if (!magic) {
      logger.warn("Outbound app-link: could not mint magic link", { conversationId, userId });
      return;
    }
    // &intake=<conversation_id> self-links the eventual web draft to this call.
    const link = magic.link.includes("intake=")
      ? magic.link
      : `${magic.link}&intake=${encodeURIComponent(conversationId)}`;
    sendMagicLinkSms(userId, link);
    void stampTape({
      kind: "VOICE_TOOL_INVOKED",
      actor: "outbound-validation",
      sessionId: conversationId,
      payload: { tool: "send_app_link", phase: "outbound_post_call", applicantId, userId },
    });
    logger.info("Outbound app-link sent", { conversationId, userId });
  } catch (err) {
    logger.error("Outbound app-link failed", {
      conversationId,
      applicantId,
      error: (err as Error).message,
    });
  }
}

export async function handleOutboundPostCall(payload: PostCallPayload): Promise<void> {
  const local = await findLocalCall(payload);
  if (!local) {
    logger.warn("Outbound validation webhook: no local call row for conversation", {
      conversationId: payload.conversation_id,
    });
    return;
  }
  if (local.status === "completed") {
    logger.info("Outbound validation webhook: already completed, skipping", {
      conversationId: payload.conversation_id,
    });
    return;
  }

  const mapped = mapPostCallToOutcome(payload);

  // Atomically claim the row BEFORE the Sage write. ElevenLabs can deliver the
  // same post-call event more than once (retries, at-least-once delivery); the
  // fast-path check above is racy on its own, so the flip to 'completed' is the
  // real idempotency fence. Only the webhook that wins this CAS (status was still
  // 'dialed') proceeds to record on Sage — losers see 0 rows and return, so the
  // applicant's call_attempts is never double-incremented.
  const claim = await query(
    `UPDATE outbound_validation_calls
        SET status = 'completed', outcome = $2, completed_at = NOW()
      WHERE id = $1 AND status = 'dialed'
      RETURNING id`,
    [local.id, mapped.outcome]
  );
  if (claim.rows.length === 0) {
    logger.info("Outbound validation webhook: row already claimed by a concurrent delivery, skipping", {
      conversationId: payload.conversation_id,
      callId: local.id,
    });
    return;
  }

  // We own the row now. Write to Sage. Skip it entirely for test calls — those
  // dial a test number, so the claimed applicant's row was only used to build the
  // script; recording this outcome would corrupt a real applicant.
  if (!local.test_call) {
    try {
      await recordCallOutcome({
        applicantId: local.applicant_id,
        outcome: mapped.outcome,
        stillInterested: mapped.stillInterested,
        notes: mapped.notes,
      });
    } catch (err) {
      // Sage failed after we claimed the row locally. Revert the claim so local
      // and Sage stay consistent (the row goes back to 'dialed', re-openable by a
      // retry or the sweeper) and rethrow so the webhook DLQ re-delivers the whole
      // event. Without this the row would sit 'completed' while Sage never recorded
      // the attempt — and the sweeper would never touch it again.
      await query(
        `UPDATE outbound_validation_calls
            SET status = 'dialed', outcome = NULL, completed_at = NULL
          WHERE id = $1`,
        [local.id]
      );
      logger.error("Outbound validation webhook: Sage write failed, reverted local row to dialed", {
        conversationId: payload.conversation_id,
        applicantId: local.applicant_id,
        error: (err as Error).message,
      });
      throw err;
    }
  }

  logger.info("Outbound validation outcome recorded", {
    conversationId: payload.conversation_id,
    applicantId: local.applicant_id,
    outcome: mapped.outcome,
    stillInterested: mapped.stillInterested,
    testCall: local.test_call,
  });

  // Golden-path: a CONFIRMED outbound call launches the same text→link→walkthrough
  // chain as inbound. Dark by default; never fires on test calls (those dial a test
  // number, not the applicant). Best-effort — a text failure can't affect the call.
  if (
    process.env.FRANK_OUTBOUND_APP_LINK_ENABLED === "true" &&
    mapped.outcome === "confirmed" &&
    !local.test_call
  ) {
    void sendOutboundAppLink(local.applicant_id, payload.conversation_id);
  }
}
