-- Feedback-loop Phase 2 — "review EVERY call" (battlestation docs/FRANK-FEEDBACK-LOOP.md).
--
-- The post-call webhook can't run the review itself: the review pass
-- (/call-review + frank-improve) executes on the operator's machine,
-- Governor-gated. So the webhook does the smallest possible thing at the
-- edge: enqueue the conversation id here (flag-gated on
-- CALL_REVIEW_QUEUE_ENABLED, idempotent on conversation_id). The
-- battlestation-side drain polls status='pending', pulls each transcript
-- from the ElevenLabs API into ~/frank-feed/switchboard/, runs the review,
-- and flips the row to 'reviewed'.
--
-- Queue rows carry ids + timing ONLY — no transcript, no PII. Transcripts
-- stay in ElevenLabs until the operator-side drain pulls them.

BEGIN;

CREATE TABLE IF NOT EXISTS call_review_queue (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id    TEXT NOT NULL UNIQUE,
  agent_id           TEXT NOT NULL,
  event_type         TEXT NOT NULL,
  call_started_at    TIMESTAMPTZ,
  call_duration_secs INTEGER,
  status             TEXT NOT NULL DEFAULT 'pending',  -- pending | reviewed | skipped
  enqueued_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at        TIMESTAMPTZ,
  review_ref         TEXT  -- drain writes back its artifact ref (feed filename / ledger fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_call_review_queue_pending
  ON call_review_queue(enqueued_at)
  WHERE status = 'pending';

COMMIT;
