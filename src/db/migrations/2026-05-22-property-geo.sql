-- Property geocoordinates (2026-05-22)
-- Adds latitude/longitude to properties so the statewide Nevada housing map
-- and the /discover funnel can share ONE dataset (the DB) instead of the
-- hardcoded PROPS array in client-tenant/public/nv-housing-map.html.
--
-- Nullable: not every property necessarily has coords (the backfill in
-- src/db/seed-property-geo.ts populates them from the HUD LIHTC map data).
-- Idempotent — safe to re-apply.

ALTER TABLE properties ADD COLUMN IF NOT EXISTS latitude  DOUBLE PRECISION;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

-- Markers API (GET /api/applicants/properties/map) only ever returns rows with
-- both coords set; this partial index keeps that scan cheap as the catalog
-- grows statewide.
CREATE INDEX IF NOT EXISTS idx_properties_geo
  ON properties (latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
