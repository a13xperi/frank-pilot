-- Unit-identity Phase B (4/7): unit_permits — permits recur per unit over time
-- (building permit, electrical, certificate of occupancy), so a child table is
-- correct; units.primary_permit_number is the denormalized convenience copy.
-- Windsor populates one 'building' permit per lot today; GPM permits (currently
-- only in the Blue Star Stage-2 worksheet, unstructured) are simply not loaded
-- yet -- zero rows, no placeholders.
CREATE TABLE IF NOT EXISTS unit_permits (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  unit_id       UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  permit_number VARCHAR(40) NOT NULL,
  permit_type   VARCHAR(40),
  jurisdiction  VARCHAR(60),
  issued_date   DATE,
  permit_source VARCHAR(60),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (unit_id, permit_number)
);
CREATE INDEX IF NOT EXISTS idx_unit_permits_number ON unit_permits(permit_number);
CREATE INDEX IF NOT EXISTS idx_unit_permits_unit   ON unit_permits(unit_id);
