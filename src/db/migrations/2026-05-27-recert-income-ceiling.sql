-- QAP acquisitions Phase 3.1 — recert income-ceiling enforcement.
-- Idempotent. Matches the income_ceiling_* columns added to the
-- recertifications block in schema.ts.
--
-- At recertification a household's recertified income is measured against the
-- income ceiling its occupied unit's AMI designation enforces (units.ami_designation,
-- Phase 3), applying the 140% Available Unit Rule (IRC §42(g)(2)(D)(ii)). The
-- resulting verdict + the limit it was measured against are snapshotted here so
-- the review UI/API can show the auto-check alongside the manual decision; the
-- immutable record lives on the compliance tape (acq.recert_income_checked).

ALTER TABLE recertifications
  ADD COLUMN IF NOT EXISTS income_ceiling_verdict TEXT
    CHECK (income_ceiling_verdict IN
      ('not_restricted','qualified','over_income_aur','over_income','indeterminate')),
  ADD COLUMN IF NOT EXISTS income_ceiling_designation TEXT
    CHECK (income_ceiling_designation IN ('30','50','60','market')),
  ADD COLUMN IF NOT EXISTS income_ceiling_limit DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS income_ceiling_income DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS income_ceiling_checked_at TIMESTAMPTZ;

-- Surface over-income recerts for follow-up (Available Unit Rule queue).
CREATE INDEX IF NOT EXISTS idx_recertifications_income_verdict
  ON recertifications(income_ceiling_verdict)
  WHERE income_ceiling_verdict IN ('over_income_aur','over_income');
