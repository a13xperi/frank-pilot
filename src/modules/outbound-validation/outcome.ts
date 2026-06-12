import { query } from "../../config/database";
import { logger } from "../../utils/logger";
import { pickField, type PostCallPayload } from "../voice-intake/service";
import { recordCallOutcome, type GpmOutcome } from "./sage-client";

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

  // Sage write first: if it throws, the webhook DLQ parks the event and the
  // local row stays 'dialed' for the retry to converge on.
  await recordCallOutcome({
    applicantId: local.applicant_id,
    outcome: mapped.outcome,
    stillInterested: mapped.stillInterested,
    notes: mapped.notes,
  });

  await query(
    `UPDATE outbound_validation_calls
        SET status = 'completed', outcome = $2, completed_at = NOW()
      WHERE id = $1`,
    [local.id, mapped.outcome]
  );

  logger.info("Outbound validation outcome recorded", {
    conversationId: payload.conversation_id,
    applicantId: local.applicant_id,
    outcome: mapped.outcome,
    stillInterested: mapped.stillInterested,
    testCall: local.test_call,
  });
}
