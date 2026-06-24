-- Property amenities / pet policy / accessibility — so Frank can answer
-- "what amenities does it have / is it pet-friendly / is it accessible?" for
-- free on the call. Addresses + the senior/family designation (property_type)
-- already exist on properties; this fills the one data gap (amenities), backfilled
-- from docs/intel/gpmglv-properties-extracted.json by the seed-amenities script.
-- Idempotent: ADD COLUMN IF NOT EXISTS only.

ALTER TABLE properties ADD COLUMN IF NOT EXISTS amenities JSONB DEFAULT '[]'::jsonb;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS pet_policy TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS accessibility JSONB DEFAULT '[]'::jsonb;
