-- Compliance-tape stamp dead-letter queue (BP-02).
--
-- The acquisitions stamp sites (award-service.ts stampSafe, recert-compliance.ts
-- stampNau + stampSafe) deliberately swallow tape failures so a tape outage can
-- never block a durable management-side write (units.ami_designation, a recert
-- review). Until now that swallow was log-only: a failed stamp vanished into the
-- logs and the compliance record was silently lost — the exact gap the
-- 2026-05-23-compliance-tape.sql migration comment flagged.
--
-- This table makes the failure durable + queryable + replayable. parkFailedStamp()
-- (src/modules/tape/dlq.ts) writes the full TapeEvent here on a swallowed error;
-- replayTapeDlq() re-stamps unresolved rows (dark cron, gated on
-- COMPLIANCE_TAPE_V2_ENABLED). Same DLQ pattern as cra_webhook_dlq, minus the
-- event_id idempotency key (acq stamps carry no natural delivery id — each failed
-- stamp is a discrete row; the active-row cap is the runaway backstop).
--
-- What's stored is exactly the payload the tape itself would have held
-- (compliance metadata: award/recert/unit ids + categorical verdicts) — no SSN,
-- DOB, name, or other raw PII ever reaches this table.

CREATE TABLE IF NOT EXISTS compliance_tape_dlq (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            TEXT NOT NULL,
  session_id      TEXT,
  payload         JSONB NOT NULL,
  error_message   TEXT,
  attempt_count   INT NOT NULL DEFAULT 1,
  first_failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_failed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ
);

-- Drives both the replay scan (unresolved, oldest first) and the active-row cap.
CREATE INDEX IF NOT EXISTS idx_compliance_tape_dlq_unresolved
  ON compliance_tape_dlq (first_failed_at)
  WHERE resolved_at IS NULL;
