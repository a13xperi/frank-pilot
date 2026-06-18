-- Unit-identity Phase B (3/7): per-unit identity columns. lot_number = Windsor
-- lot (lot == unit). parcel_id = direct unit->parcel link for single-parcel sites
-- where there is no meaningful building subdivision (a unit resolves its parcel
-- via building_id -> buildings.parcel_id OR directly via units.parcel_id; the
-- unit_identity view coalesces them). primary_permit_number = the denormalized
-- "the permit" for fast reads (full history lives in unit_permits). external_uid
-- = the source-system identity token (e.g. WNDSR-001). All additive + nullable.
ALTER TABLE units ADD COLUMN IF NOT EXISTS lot_number            VARCHAR(20);
ALTER TABLE units ADD COLUMN IF NOT EXISTS parcel_id             UUID REFERENCES parcels(id) ON DELETE SET NULL;
ALTER TABLE units ADD COLUMN IF NOT EXISTS primary_permit_number VARCHAR(40);
ALTER TABLE units ADD COLUMN IF NOT EXISTS external_uid          VARCHAR(40);
CREATE INDEX IF NOT EXISTS idx_units_parcel ON units(parcel_id);
CREATE INDEX IF NOT EXISTS idx_units_permit ON units(primary_permit_number) WHERE primary_permit_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_units_external_uid ON units(external_uid) WHERE external_uid IS NOT NULL;
