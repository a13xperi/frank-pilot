-- Buildings + BIN (2026-05-30)
-- LIHTC §42 Phase A — data layer only, ZERO compliance-enforcement change.
-- Adds the `buildings` table (one row per LIHTC Building Identification Number),
-- a nullable `units.building_id` FK, and a `properties.election_8b` flag
-- (Form 8609 line 8b — NULL = unknown). BINs are nullable (5 are blank in the
-- GPMG source) and never invented; the fletcher mapping is provisional.
-- Idempotent — safe to re-apply (mirrors 2026-05-14-units-and-intent.sql).

CREATE TABLE IF NOT EXISTS buildings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id   UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  building_code VARCHAR(20) NOT NULL,
  bin           VARCHAR(20),                       -- nullable: 5 are blank
  bin_confidence VARCHAR(12) NOT NULL DEFAULT 'confirmed'
                 CHECK (bin_confidence IN ('confirmed','provisional')),
  bin_source    VARCHAR(40),
  unit_count    INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (property_id, building_code)
);

-- A BIN is globally unique when present; NULLs are exempt (5 blank in source).
CREATE UNIQUE INDEX IF NOT EXISTS idx_buildings_bin ON buildings(bin) WHERE bin IS NOT NULL;

-- Link units to their building. Nullable: most seeded units never map (the
-- bins.json unit-number scheme does not overlap the synthetic seeded scheme).
ALTER TABLE units ADD COLUMN IF NOT EXISTS building_id UUID REFERENCES buildings(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_units_building ON units(building_id);

-- Form 8609 line 8b — multi-building project treated as one. NULL = unknown.
ALTER TABLE properties ADD COLUMN IF NOT EXISTS election_8b BOOLEAN;
