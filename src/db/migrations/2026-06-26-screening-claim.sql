-- 2026-06-26 — screening run claim (audit #7). runFullScreening can be reached
-- from the manual /screen route AND the auto-on-submit path for the SAME app, and
-- both fire real (billable) Checkr/TransUnion pulls — duplicate cost + conflicting
-- verdicts. This column backs a claim-with-TTL so exactly one run proceeds at a
-- time; a legitimate re-screen later (past the TTL) still works. Idempotent.

ALTER TABLE applications ADD COLUMN IF NOT EXISTS screening_started_at TIMESTAMPTZ;
