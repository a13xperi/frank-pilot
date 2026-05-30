-- Screening on the applicant funnel (auto-trigger on submit).
--
-- Adds the audit_action used by the application_status chokepoint
-- (transitionApplicationStatus) and the append-only status_history trail the
-- chokepoint writes on every screening-driven status move. No application_status
-- enum change — the in-flight `screening` state already exists and is handled by
-- the cancel/verify guards and the approval queue.
--
-- Both statements are idempotent. ADD VALUE cannot run inside a transaction
-- block, so apply this file directly via psql (NOT wrapped in BEGIN/COMMIT):
--   psql "$DATABASE_URL" -f src/db/migrations/2026-05-31-screening-on-submit.sql

ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'screening_state_transition';

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS status_history JSONB NOT NULL DEFAULT '[]'::jsonb;
