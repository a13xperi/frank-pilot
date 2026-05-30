-- 2026-05-31 screening-review-status
--
-- Adds the non-approvable HOLD status for screenings that could not be run
-- (vendor down / no key / "Production API integration not yet configured").
-- A misconfigured pipeline must NEVER produce 'screening_passed'; it lands in
-- 'screening_review' for staff to resolve. A genuine borderline 'review_required'
-- verdict is unchanged and still passes through to 'screening_passed'.
--
-- NOTE: ALTER TYPE ... ADD VALUE cannot run inside a transaction block.
-- Apply this file OUTSIDE a transaction, e.g.:
--   psql "$DATABASE_URL" -f src/db/migrations/2026-05-31-screening-review-status.sql
-- (Do NOT wrap in BEGIN/COMMIT; do NOT run via a migration runner that opens a txn.)

ALTER TYPE application_status ADD VALUE IF NOT EXISTS 'screening_review';
ALTER TYPE screening_result ADD VALUE IF NOT EXISTS 'could_not_screen';
