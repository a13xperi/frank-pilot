import { query } from "../../config/database";
import { logger } from "../../utils/logger";

/**
 * Tenant-call feedback capture (Frank core C1).
 *
 * A reviewer marks a completed Frank call transcript good/bad. The mark is the
 * supervision signal for the training-dataset refresh (see ./dataset.ts). This
 * module owns:
 *   - resolveCallChannel: which source table a conversation_id belongs to
 *     (inbound voice_intake_calls vs outbound outbound_validation_calls), and
 *     whether the call is actually markable (a completed real call, not a
 *     dry-run or a still-in-flight dial).
 *   - captureCallFeedback: UPSERT one (conversation, rater) mark.
 *   - getFeedbackForCall: read marks for one call (PM console display).
 *
 * The transcript itself is NOT copied here — the dataset assembler joins back
 * to the source row at build time, so an upstream transcript correction is
 * reflected on the next refresh.
 *
 * MID-CALL DEV MODE — HOOK POINT (intentionally not wired to anything live):
 * a future "dev mode" lets an operator thumbs-up/down a turn WHILE the call is
 * happening, to steer the live agent. That would call captureCallFeedback with
 * channel resolved from the in-flight conversation and an additional
 * turn-index/segment field. We deliberately do NOT open that path here: it
 * needs a live ElevenLabs conversation socket + a mid-call control channel we
 * can't unit-test. When it lands, it reuses captureCallFeedback (extend the
 * UNIQUE key to (conversation_id, rated_by, turn_index)) — the data model and
 * capture function below are the seam.
 */

export type CallFeedbackChannel = "inbound" | "outbound";
export type CallFeedbackMark = "good" | "bad";

const NOTE_MAX = 2000;

export interface CaptureFeedbackInput {
  conversationId: string;
  mark: CallFeedbackMark;
  ratedBy: string | null;
  note?: string | null;
  tags?: string[];
}

export interface CallFeedbackRow {
  id: string;
  conversation_id: string;
  channel: CallFeedbackChannel;
  mark: CallFeedbackMark;
  note: string | null;
  tags: string[];
  rated_by: string | null;
  rated_at: string;
  updated_at: string;
  dataset_included_at: string | null;
}

export interface ResolvedCall {
  channel: CallFeedbackChannel;
  /** False for a dry-run / in-flight / failed call — these are not markable. */
  markable: boolean;
  reason?: string;
}

/**
 * Determine which source table owns a conversation_id and whether it is a
 * completed, markable call.
 *
 * Inbound (voice_intake_calls): every persisted row is a real completed
 * conversation, so presence ⇒ markable.
 *
 * Outbound (outbound_validation_calls): only a row whose status is 'completed'
 * (a real call that produced a post-call webhook) is markable — 'dry_run',
 * 'dialed' (in flight), 'dial_failed' and 'expired' are not. dry_run rows also
 * carry a NULL conversation_id, so they can never be looked up here anyway.
 *
 * Returns null when the conversation_id is unknown to both tables.
 */
export async function resolveCallChannel(
  conversationId: string
): Promise<ResolvedCall | null> {
  const inbound = await query(
    `SELECT 1 FROM voice_intake_calls WHERE conversation_id = $1 LIMIT 1`,
    [conversationId]
  );
  if (inbound.rows.length > 0) {
    return { channel: "inbound", markable: true };
  }

  const outbound = await query(
    `SELECT status FROM outbound_validation_calls WHERE conversation_id = $1 LIMIT 1`,
    [conversationId]
  );
  if (outbound.rows.length > 0) {
    const status = String(outbound.rows[0].status);
    if (status === "completed") return { channel: "outbound", markable: true };
    return {
      channel: "outbound",
      markable: false,
      reason: `outbound call status is '${status}', not 'completed'`,
    };
  }

  return null;
}

/**
 * Capture (UPSERT) one good/bad mark for a call transcript.
 *
 * A rater can flip their own prior mark on the same call (good<->bad) — the
 * UNIQUE(conversation_id, rated_by) constraint turns the second write into an
 * update, and flipping a mark CLEARS dataset_included_at so the next refresh
 * re-evaluates it. Two raters marking the same call are distinct rows.
 *
 * Throws {code:'CALL_NOT_FOUND'} for an unknown conversation and
 * {code:'CALL_NOT_MARKABLE'} for a dry-run / in-flight / failed call, so the
 * route can map them to 404 / 409 respectively.
 */
export async function captureCallFeedback(
  input: CaptureFeedbackInput
): Promise<CallFeedbackRow> {
  const resolved = await resolveCallChannel(input.conversationId);
  if (!resolved) {
    throw Object.assign(new Error("call not found"), { code: "CALL_NOT_FOUND" });
  }
  if (!resolved.markable) {
    throw Object.assign(new Error(resolved.reason ?? "call not markable"), {
      code: "CALL_NOT_MARKABLE",
    });
  }

  const note = (input.note ?? "").trim().slice(0, NOTE_MAX) || null;
  const tags = Array.isArray(input.tags)
    ? input.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 32)
    : [];

  const result = await query(
    `INSERT INTO call_transcript_feedback
       (conversation_id, channel, mark, note, tags, rated_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (conversation_id, rated_by) DO UPDATE SET
       mark = EXCLUDED.mark,
       note = EXCLUDED.note,
       tags = EXCLUDED.tags,
       channel = EXCLUDED.channel,
       updated_at = NOW(),
       -- A changed mark must be re-considered by the next dataset build.
       dataset_included_at = CASE
         WHEN call_transcript_feedback.mark <> EXCLUDED.mark THEN NULL
         ELSE call_transcript_feedback.dataset_included_at
       END
     RETURNING id, conversation_id, channel, mark, note, tags, rated_by,
               rated_at, updated_at, dataset_included_at`,
    [
      input.conversationId,
      resolved.channel,
      input.mark,
      note,
      tags,
      input.ratedBy,
    ]
  );

  const row = result.rows[0] as CallFeedbackRow;
  logger.info("Call transcript feedback captured", {
    conversationId: input.conversationId,
    channel: resolved.channel,
    mark: input.mark,
    ratedBy: input.ratedBy,
  });
  return row;
}

/** All marks for one call, newest first (PM console display). */
export async function getFeedbackForCall(
  conversationId: string
): Promise<CallFeedbackRow[]> {
  const result = await query(
    `SELECT id, conversation_id, channel, mark, note, tags, rated_by,
            rated_at, updated_at, dataset_included_at
       FROM call_transcript_feedback
      WHERE conversation_id = $1
      ORDER BY rated_at DESC`,
    [conversationId]
  );
  return result.rows as CallFeedbackRow[];
}
