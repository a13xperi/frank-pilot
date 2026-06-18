-- Unit-identity Phase B (9/9, WS-4): re-anchor existing transactions to the unit.
-- DATA-ONLY delta — the unit_id columns + FKs/indexes were added in
-- 2026-06-16-05-transactions-unit-fk.sql; this fills them in for rows that
-- predate the write-path change. Because it mutates no schema, it has NO
-- SCHEMA_SQL mirror (a fresh/empty install backfills nothing — every UPDATE
-- is a no-op against zero rows).
--
-- Resolution chain (same join the recert income-ceiling service uses, see
-- src/modules/acquisitions/recert-compliance.ts ~line 112):
--   txn -> applications a ON txn.application_id = a.id
--        -> units u ON a.claimed_unit_id = u.id          (primary)
-- A secondary pass covers legacy rows where the applicant never went through
-- the unit-picker (claimed_unit_id NULL) but a unit_number was recorded on the
-- application: match units ON (property_id, unit_number). Safe to equate
-- because units carries UNIQUE(property_id, unit_number).
--
-- Idempotent + re-runnable: every UPDATE is guarded WHERE txn.unit_id IS NULL,
-- so already-anchored rows (including any set by the write-path going forward)
-- are never touched. Null-tolerant: a row whose application resolves to no unit
-- stays unit_id NULL — the unit is the spine, but a tenancy episode without a
-- resolvable unit is left forward-only rather than guessed.
--
-- SCOPE — the FIVE MUTABLE tables only: tenant_ledger, recertifications,
-- lease_violations, lease_renewals, move_outs. audit_log and compliance_tape
-- are append-only (their row-level mutation triggers REJECT UPDATE), so their
-- unit_id / subject_unit_id is FORWARD-ONLY (set at INSERT going forward,
-- existing rows stay NULL) and are deliberately EXCLUDED from this backfill.

-- ---------------------------------------------------------------------------
-- Primary pass: anchor via applications.claimed_unit_id.
-- ---------------------------------------------------------------------------
UPDATE tenant_ledger t
   SET unit_id = a.claimed_unit_id
  FROM applications a
 WHERE t.application_id = a.id
   AND t.unit_id IS NULL
   AND a.claimed_unit_id IS NOT NULL;

UPDATE recertifications r
   SET unit_id = a.claimed_unit_id
  FROM applications a
 WHERE r.application_id = a.id
   AND r.unit_id IS NULL
   AND a.claimed_unit_id IS NOT NULL;

UPDATE lease_violations v
   SET unit_id = a.claimed_unit_id
  FROM applications a
 WHERE v.application_id = a.id
   AND v.unit_id IS NULL
   AND a.claimed_unit_id IS NOT NULL;

UPDATE lease_renewals lr
   SET unit_id = a.claimed_unit_id
  FROM applications a
 WHERE lr.application_id = a.id
   AND lr.unit_id IS NULL
   AND a.claimed_unit_id IS NOT NULL;

UPDATE move_outs m
   SET unit_id = a.claimed_unit_id
  FROM applications a
 WHERE m.application_id = a.id
   AND m.unit_id IS NULL
   AND a.claimed_unit_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Secondary pass: anchor remaining NULLs via (property_id, unit_number).
-- Only fires where claimed_unit_id was NULL but a unit_number is on file.
-- UNIQUE(property_id, unit_number) on units guarantees a single match.
-- ---------------------------------------------------------------------------
UPDATE tenant_ledger t
   SET unit_id = u.id
  FROM applications a
  JOIN units u
    ON u.property_id = a.property_id
   AND u.unit_number = a.unit_number
 WHERE t.application_id = a.id
   AND t.unit_id IS NULL
   AND a.claimed_unit_id IS NULL
   AND a.unit_number IS NOT NULL;

UPDATE recertifications r
   SET unit_id = u.id
  FROM applications a
  JOIN units u
    ON u.property_id = a.property_id
   AND u.unit_number = a.unit_number
 WHERE r.application_id = a.id
   AND r.unit_id IS NULL
   AND a.claimed_unit_id IS NULL
   AND a.unit_number IS NOT NULL;

UPDATE lease_violations v
   SET unit_id = u.id
  FROM applications a
  JOIN units u
    ON u.property_id = a.property_id
   AND u.unit_number = a.unit_number
 WHERE v.application_id = a.id
   AND v.unit_id IS NULL
   AND a.claimed_unit_id IS NULL
   AND a.unit_number IS NOT NULL;

UPDATE lease_renewals lr
   SET unit_id = u.id
  FROM applications a
  JOIN units u
    ON u.property_id = a.property_id
   AND u.unit_number = a.unit_number
 WHERE lr.application_id = a.id
   AND lr.unit_id IS NULL
   AND a.claimed_unit_id IS NULL
   AND a.unit_number IS NOT NULL;

UPDATE move_outs m
   SET unit_id = u.id
  FROM applications a
  JOIN units u
    ON u.property_id = a.property_id
   AND u.unit_number = a.unit_number
 WHERE m.application_id = a.id
   AND m.unit_id IS NULL
   AND a.claimed_unit_id IS NULL
   AND a.unit_number IS NOT NULL;
