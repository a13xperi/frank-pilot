-- 2026-06-01 applications-consumer-report (background + credit CRA adapter)
--
-- Checkr (background/criminal) and TransUnion ShareAble (credit/eviction) are
-- asynchronous + applicant-mediated, the same shape as Stripe Identity (#244):
-- submit() creates the report order(s), the applicant authorizes + completes
-- KBA on the CRA's hosted flow, and the verdict arrives later by WEBHOOK. We
-- therefore need:
--
--   1. A new application_status `awaiting_consumer_report` — the state between
--      `submitted` and `screening` that means "waiting on the applicant to
--      authorize + complete their Checkr / TransUnion consumer reports". A
--      report still in progress is NOT a problem to surface in the
--      screening_review HOLD queue, it's a pending capture. Screening only
--      begins once the webhook lands a verdict and transitions
--      awaiting_consumer_report -> screening (or -> screening_review on a
--      could_not_screen HOLD; never an auto-pass).
--
--   2. Columns tracking the two report references + their categorical session
--      statuses + the applicant authorization timestamp. We persist ONLY a
--      report-reference id + categorical statuses — never charge narratives,
--      tradeline detail, addresses, full DOB/SSN. Those high-sensitivity PII
--      artifacts live exclusively on the CRA; the mapped categorical verdicts
--      land in the EXISTING background_check_* / credit_check_* / credit_score
--      columns (added 2026-05-30-applications-extended-screening-columns.sql and
--      the original applications schema).
--
-- NOTE: ALTER TYPE ... ADD VALUE cannot run inside a transaction block.
-- Apply this file OUTSIDE a transaction, e.g.:
--   psql "$DATABASE_URL" -f src/db/migrations/2026-06-01-applications-consumer-report.sql
-- (Do NOT wrap in BEGIN/COMMIT; do NOT run via a migration runner that opens a txn.)

ALTER TYPE application_status ADD VALUE IF NOT EXISTS 'awaiting_consumer_report';

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS background_report_id              TEXT,
  ADD COLUMN IF NOT EXISTS credit_report_id                 TEXT,
  ADD COLUMN IF NOT EXISTS consumer_report_background_status TEXT,
  ADD COLUMN IF NOT EXISTS consumer_report_credit_status     TEXT,
  ADD COLUMN IF NOT EXISTS screening_authorization_at        TIMESTAMPTZ;

-- CRA webhook idempotency + dead-letter queue. Mirrors the BP-08 Stripe webhook
-- pattern (stripe_processed_events / stripe_webhook_dlq): a redelivered event_id
-- short-circuits with a 200, and any dispatch throw parks the payload here rather
-- than 5xx-ing the CRA into an infinite retry. raw_payload is the synthetic /
-- vendor envelope (categorical metadata) — it MUST NOT contain charge narratives,
-- tradeline detail, addresses, or full DOB/SSN (those never leave the CRA).
CREATE TABLE IF NOT EXISTS cra_processed_events (
  event_id       TEXT PRIMARY KEY,
  domain         TEXT NOT NULL,
  application_id UUID,
  processed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cra_webhook_dlq (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        TEXT UNIQUE NOT NULL,
  domain          TEXT NOT NULL,
  raw_payload     JSONB NOT NULL,
  error_message   TEXT,
  attempt_count   INT NOT NULL DEFAULT 1,
  first_failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_failed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
