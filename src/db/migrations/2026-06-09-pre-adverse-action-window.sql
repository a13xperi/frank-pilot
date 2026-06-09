-- 2026-06-09 pre-adverse-action-window
--
-- Adds the flag-gated (FCRA_PRE_ADVERSE_ENABLED) pre-adverse-action hold:
-- a consumer-report-derived denial parks in 'pending_adverse_action', the
-- applicant receives an intent-to-deny notice + copy-of-report/dispute rights +
-- an N-business-day window, and a daily scheduler finalizes after the window to
-- 'screening_failed' with the existing § 1681m final notice.
--
-- Legal framing: FCRA § 1681b(b)(3) (the pre-adverse subsection) governs
-- EMPLOYMENT screening, not rental. Rental's federal duty is the § 1681m
-- POST-action notice (already shipped). This window is therefore a configurable
-- best-practice / HUD-aligned / state-law-ready hold, default OFF.
--
--   * application_status += 'pending_adverse_action'
--   * applications.adverse_action_eligible_at — when the hold may be finalized
--   * adverse_action_notices.stage — 'pre_adverse' vs 'adverse' (default keeps
--     existing rows + the unchanged sendNotice INSERT byte-identical)
--
-- NOTE: ALTER TYPE ... ADD VALUE cannot run inside a transaction block.
-- Apply this file OUTSIDE a transaction, e.g.:
--   psql "$DATABASE_URL" -f src/db/migrations/2026-06-09-pre-adverse-action-window.sql
-- (Do NOT wrap in BEGIN/COMMIT; do NOT run via a migration runner that opens a txn.)

ALTER TYPE application_status ADD VALUE IF NOT EXISTS 'pending_adverse_action';

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS adverse_action_eligible_at TIMESTAMPTZ;

ALTER TABLE adverse_action_notices
  ADD COLUMN IF NOT EXISTS stage VARCHAR(20) NOT NULL DEFAULT 'adverse';
