-- Concierge co-browse — Tier 1 "guided co-pilot" step-sync columns.
--
-- Tier 1 is the SAFE half of the co-browse vision (no computer-use, no counsel
-- gate): the applicant fills out their OWN /apply wizard in their OWN
-- authenticated session, and Frank — live on the phone — narrates the right
-- guidance for whatever step they're on (including how to get pay stubs). The
-- applicant's browser reports its CURRENT STEP back to the server; Frank's
-- `cobrowse_status` voice tool reads that step + the coaching script for it.
--
-- PII-minimal (unchanged posture): we persist only the STEP KEY the applicant
-- is on (e.g. 'income', 'documents', 'ssn') and timestamps — NEVER the field
-- values they type. No name, SSN, DOB, income figure, or card number lands here.
--
-- Gated behind COBROWSE_GUIDED_ENABLED (a SEPARATE flag from the counsel-gated
-- COBROWSE_ENABLED). Tier 1 drives no browser and submits nothing, so it can be
-- flipped on without the autonomous-form-driving sign-off the orchestrator
-- needs. Adding these columns is inert until that flag is true.

ALTER TABLE cobrowse_sessions
  ADD COLUMN IF NOT EXISTS current_step      VARCHAR(24),
  ADD COLUMN IF NOT EXISTS steps_reached     INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS guided_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_step_at      TIMESTAMPTZ;
