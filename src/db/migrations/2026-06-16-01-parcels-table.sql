-- Unit-identity Phase B (1/7): parcels — the APN layer between properties and
-- buildings. A single managed site can span multiple Assessor parcels (the GPM
-- 17-building portfolio proves it), each with its own APN / owner / AHJ, so APN is
-- a parcel fact, not a building fact. apn is nullable: a single-parcel residential
-- site (Windsor) has one parcel with no per-unit APN. Mirrors the buildings
-- bin_confidence / bin_source fail-closed pattern — a disputed APN is 'provisional'
-- and never silently trusted. Additive + nullable; safe to re-run.
CREATE TABLE IF NOT EXISTS parcels (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id     UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  apn             VARCHAR(20),
  apn_county      VARCHAR(40),
  owner_of_record VARCHAR(200),
  ahj             VARCHAR(60),
  census_tract    VARCHAR(20),
  apn_confidence  VARCHAR(12) NOT NULL DEFAULT 'confirmed'
                  CHECK (apn_confidence IN ('confirmed','provisional')),
  apn_source      VARCHAR(60),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (property_id, apn)
);

-- A confirmed APN is globally unique; NULLs and provisional rows are exempt.
CREATE UNIQUE INDEX IF NOT EXISTS idx_parcels_apn
  ON parcels(apn) WHERE apn IS NOT NULL AND apn_confidence = 'confirmed';
CREATE INDEX IF NOT EXISTS idx_parcels_property ON parcels(property_id);
