-- 2026-06-01 applications-identity-session (Phase 4b — Stripe Identity go-live)
--
-- Stripe Identity is asynchronous + applicant-mediated: submit() creates a
-- VerificationSession, the applicant uploads ID + selfie on Stripe's hosted/
-- embedded flow, and the verdict arrives later by WEBHOOK. We therefore need:
--
--   1. A new application_status `awaiting_identity` — the state between
--      `submitted` and `screening` that means "waiting on the applicant to
--      finish their Stripe Identity capture". This keeps the screening_review
--      HOLD queue clean: a session still in progress is NOT a problem, it's a
--      pending capture. Screening only begins once the webhook lands a verdict
--      and transitions awaiting_identity -> screening.
--
--   2. Three columns tracking the Stripe session reference. We persist ONLY a
--      `vs_…` id + the categorical session status — never name/DOB/document
--      numbers/images. Those high-sensitivity PII artifacts live on Stripe; the
--      mapped categorical verdict lands in the existing identity_verification_*
--      columns (added 2026-05-30-applications-identity-verification.sql).
--
-- NOTE: ALTER TYPE ... ADD VALUE cannot run inside a transaction block.
-- Apply this file OUTSIDE a transaction, e.g.:
--   psql "$DATABASE_URL" -f src/db/migrations/2026-06-01-applications-identity-session.sql
-- (Do NOT wrap in BEGIN/COMMIT; do NOT run via a migration runner that opens a txn.)

ALTER TYPE application_status ADD VALUE IF NOT EXISTS 'awaiting_identity';

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS identity_session_id          TEXT,
  ADD COLUMN IF NOT EXISTS identity_session_status      TEXT,
  ADD COLUMN IF NOT EXISTS identity_session_created_at  TIMESTAMPTZ;
