-- Property QCT/DDA + census tract (2026-05-22) — QAP acquisitions layer.
-- The Nevada 2026 LIHTC QAP scores project location (§7.3.1) and grants a 30%
-- eligible-basis boost (§11) for properties in a HUD Qualified Census Tract
-- (QCT) or Difficult Development Area (DDA). The acquisitions Demand-Evidence
-- Engine reads these flags to tie funnel demand to the geographic accounts and
-- to flag basis-boost-eligible submarkets.
--
-- All nullable: legacy properties predate the QCT/DDA designation lookup.
-- Idempotent — safe to re-apply.

ALTER TABLE properties ADD COLUMN IF NOT EXISTS census_tract VARCHAR(20);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS is_qct BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS is_dda BOOLEAN NOT NULL DEFAULT false;

-- Demand-evidence rollups filter on basis-boost eligibility; a partial index
-- keeps "QCT/DDA submarkets" scans cheap as the catalog grows statewide.
CREATE INDEX IF NOT EXISTS idx_properties_basis_boost
  ON properties (is_qct, is_dda)
  WHERE is_qct = true OR is_dda = true;
