-- QAP acquisitions layer — Phase 3 Compliance Bridge.
-- Idempotent. Matches the acq_awards block + units.ami_designation column in
-- schema.ts (SCHEMA_SQL bootstrap).
--
-- Closes the flywheel: a scored candidate project (acq_projects, Phase 2) that
-- WINS a credit reservation becomes an acq_award; once bound to a real managed
-- property, the award's election + unit-mix commitment drives per-unit AMI
-- designations on that property's units. Those designations are the durable,
-- management-side record of the LURA commitment the credits were awarded for.

-- An acq_project that won a credit reservation, optionally bound to the managed
-- property it is built/operated as. One award per project (a project competes
-- once per round); re-applications create a fresh project.
CREATE TABLE IF NOT EXISTS acq_awards (
  id                         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  acq_project_id             UUID NOT NULL UNIQUE REFERENCES acq_projects(id) ON DELETE CASCADE,
  property_id                UUID REFERENCES properties(id) ON DELETE SET NULL,
  status                     TEXT NOT NULL DEFAULT 'reserved'
                               CHECK (status IN ('reserved','placed_in_service','in_service','closed')),
  reservation_amount         NUMERIC(14,2) CHECK (reservation_amount IS NULL OR reservation_amount >= 0),
  award_date                 DATE,
  placed_in_service_deadline DATE,
  notes                      TEXT,
  created_by                 UUID REFERENCES users(id),
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_acq_awards_project ON acq_awards(acq_project_id);
CREATE INDEX IF NOT EXISTS idx_acq_awards_property ON acq_awards(property_id);

-- Per-unit AMI designation flowing from a bound award's election/unit-mix.
-- NULL = undesignated (market or not-yet-assigned). The rent ceiling each
-- designation enforces is derived in compliance-bridge.ts, not stored here.
ALTER TABLE units ADD COLUMN IF NOT EXISTS ami_designation TEXT
  CHECK (ami_designation IN ('30','50','60','market'));
CREATE INDEX IF NOT EXISTS idx_units_ami_designation
  ON units(ami_designation) WHERE ami_designation IS NOT NULL;
