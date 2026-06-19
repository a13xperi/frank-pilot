-- Unit-identity Phase B (6/7): extend the append-only, hash-chained compliance
-- tape to support UNIT-scoped chains alongside the existing applicant/global
-- chains -- forward-only, so every historical chain stays byte-for-byte
-- verifiable and verify() is unchanged.
--
-- subject_unit_id is a SEPARATE scope column: applicant_id FKs users(id), so a
-- unit id can never be routed through it (that is the bug the hud-928-1 fair-
-- housing maker test guards). A row is scoped to exactly one of {applicant, unit,
-- global} -- enforced by the CHECK below.
ALTER TABLE compliance_tape
  ADD COLUMN IF NOT EXISTS subject_unit_id UUID REFERENCES units(id) ON DELETE RESTRICT;

-- The per-scope monotonic-no-gap sequence key must now span applicant XOR unit
-- XOR global. A unit row has applicant_id NULL, so the OLD 2-way index
-- (COALESCE(applicant_id, sentinel)) would collapse every unit row into the
-- global bucket and collide. COALESCE(applicant_id, subject_unit_id, sentinel)
-- gives each scope its own chain; the CHECK guarantees the two ids are never both
-- set, so the COALESCE is unambiguous. For existing rows (no unit rows yet) the
-- computed key is identical to before, so this is a safe re-key.
DROP INDEX IF EXISTS idx_compliance_tape_scope_sequence;
CREATE UNIQUE INDEX IF NOT EXISTS idx_compliance_tape_scope_sequence
  ON compliance_tape (
    COALESCE(applicant_id, subject_unit_id, '00000000-0000-0000-0000-000000000000'::uuid),
    sequence
  );

-- Scan support for verify()/list() walking a unit chain.
CREATE INDEX IF NOT EXISTS idx_compliance_tape_unit_sequence
  ON compliance_tape (subject_unit_id, sequence)
  WHERE subject_unit_id IS NOT NULL;

-- Convenience only (NON-authoritative -- not the scope key): query stamps by the
-- BIN carried in the JSON-LD payload, now that unit makers emit payload.bin.
CREATE INDEX IF NOT EXISTS idx_compliance_tape_payload_bin
  ON compliance_tape ((payload->>'bin'));

-- Exactly one scope id per row.
ALTER TABLE compliance_tape DROP CONSTRAINT IF EXISTS compliance_tape_scope_exclusive;
ALTER TABLE compliance_tape ADD CONSTRAINT compliance_tape_scope_exclusive
  CHECK (NOT (applicant_id IS NOT NULL AND subject_unit_id IS NOT NULL));
