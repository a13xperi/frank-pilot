-- DM-FRANK-024: add a property/entity scope to the compliance tape so AP
-- (property/vendor-scoped, not applicant-scoped) gets its own hash chain.
--
-- Additive + data-safe: existing rows have property_id NULL, so their scope key
-- COALESCE(applicant_id, property_id, sentinel) is unchanged, and the hash
-- inputs (sequence, prev_hash, payload, created_at) exclude the scope columns —
-- no existing entry_hash changes. Fresh DBs get this via schema.ts SCHEMA_SQL.
-- ADD COLUMN (nullable, no default) is metadata-only in PG11+, so the
-- append-only row trigger on compliance_tape never fires.

ALTER TABLE compliance_tape
  ADD COLUMN IF NOT EXISTS property_id UUID REFERENCES properties(id) ON DELETE RESTRICT;

-- Rebuild the per-scope sequence uniqueness index to fold in property_id.
DROP INDEX IF EXISTS idx_compliance_tape_scope_sequence;
CREATE UNIQUE INDEX idx_compliance_tape_scope_sequence
  ON compliance_tape (
    COALESCE(applicant_id, property_id, '00000000-0000-0000-0000-000000000000'::uuid),
    sequence
  );

CREATE INDEX IF NOT EXISTS idx_compliance_tape_property_sequence
  ON compliance_tape (property_id, sequence)
  WHERE property_id IS NOT NULL;
