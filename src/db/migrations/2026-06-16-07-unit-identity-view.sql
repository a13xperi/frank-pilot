-- Unit-identity Phase B (7/7): the Truth-Unit projection -- one row per unit
-- resolving site -> parcel(APN) -> building(BIN) -> unit -> permit. parcel is
-- coalesced from the direct unit link (single-parcel sites) then the building
-- link (multi-building sites). Read convenience; no data of its own.
CREATE OR REPLACE VIEW unit_identity AS
SELECT
  u.id   AS unit_id,
  u.unit_number,
  u.lot_number,
  u.primary_permit_number,
  u.external_uid,
  COALESCE(u.parcel_id, b.parcel_id) AS resolved_parcel_id,
  b.id   AS building_id,
  b.bin,
  b.bin_confidence,
  pc.apn,
  pc.apn_confidence,
  pc.owner_of_record,
  pc.ahj,
  p.id   AS property_id,
  p.name AS property_name
FROM units u
LEFT JOIN buildings b  ON u.building_id = b.id
LEFT JOIN parcels   pc ON COALESCE(u.parcel_id, b.parcel_id) = pc.id
JOIN properties p ON u.property_id = p.id;
