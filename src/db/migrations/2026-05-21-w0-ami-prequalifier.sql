-- W0 AMI pre-qualifier — applicant income + qualifying tier on draft (2026-05-21)
-- Adds the four fields captured by StepIntent's inline calculator so the
-- backend can persist tier on the draft application and (via a follow-up
-- query param on GET /applicants/units) filter the unit list to what the
-- applicant is income-qualified for.
--
-- Columns are nullable and additive: in-flight drafts predating this
-- migration keep working untouched; the apply UI populates them
-- opportunistically.

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS gross_annual_income          DECIMAL(12,2);
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS qualifying_ami_tier          VARCHAR(3);
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS qualifying_household_size    INTEGER;
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS qualifying_ami_calculated_at TIMESTAMPTZ;
