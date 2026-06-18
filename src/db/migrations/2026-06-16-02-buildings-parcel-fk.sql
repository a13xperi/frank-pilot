-- Unit-identity Phase B (2/7): bridge buildings -> parcels. A building optionally
-- rolls up to a parcel; LIHTC sites that only have BINs leave parcel_id NULL until
-- an APN is sourced. Nullable, ON DELETE SET NULL; no backfill gate.
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS parcel_id UUID REFERENCES parcels(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_buildings_parcel ON buildings(parcel_id);
