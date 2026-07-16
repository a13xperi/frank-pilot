import { query } from "../../config/database";
import type { PostCallPayload } from "./service";

/**
 * Feedback-loop Phase 2 — "review every call" (battlestation
 * docs/FRANK-FEEDBACK-LOOP.md).
 *
 * The webhook can't run the review itself: the review pass (/call-review +
 * frank-improve) executes on the operator's machine, Governor-gated. So this
 * module does the smallest possible thing at the webhook edge: enqueue the
 * conversation id. The battlestation drain polls status='pending', pulls each
 * transcript from the ElevenLabs API into the feed, runs the review, and
 * flips the row to 'reviewed'.
 *
 * Properties:
 *   - Flag-gated: CALL_REVIEW_QUEUE_ENABLED !== "true" → no-op. Merging this
 *     PR changes nothing in production until the flag is set.
 *   - Idempotent: ON CONFLICT (conversation_id) DO NOTHING — the same call's
 *     post_call_transcription + post_call_audio deliveries land one row.
 *   - Every line: the webhook calls this BEFORE the outbound/care-line
 *     routing splits, so tenant-line, outbound-validation, and care-line
 *     calls all get reviewed.
 *   - Caller fire-and-forgets: a queue failure must never DLQ a call event
 *     (the webhook wraps this in `void …().catch(log)`).
 *   - No PII: the row is ids + timing only.
 */
export function isCallReviewQueueEnabled(): boolean {
  return process.env.CALL_REVIEW_QUEUE_ENABLED === "true";
}

export async function enqueueCallReview(
  payload: PostCallPayload,
  eventType: string
): Promise<void> {
  if (!isCallReviewQueueEnabled()) return;
  await query(
    `INSERT INTO call_review_queue
       (conversation_id, agent_id, event_type, call_started_at, call_duration_secs)
     VALUES ($1, $2, $3, to_timestamp($4), $5)
     ON CONFLICT (conversation_id) DO NOTHING`,
    [
      payload.conversation_id,
      payload.agent_id,
      eventType,
      payload.metadata?.start_time_unix_secs ?? null,
      payload.metadata?.call_duration_secs ?? null,
    ]
  );
}
