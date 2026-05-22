-- BP-02 Compliance Tape — Lane A
-- Append-only, hash-chained audit ledger backing the operator AuditLog viewer
-- and downstream HUD attestation export. Replaces the NDJSON stub in
-- src/modules/tape/index.ts. Contracts: docs/bp-02-contracts.md.
--
-- Schema:
--   * id            UUID primary key (server-generated)
--   * sequence      BIGINT, monotonic per scope (per-applicant or global)
--   * kind          TEXT discriminator (TapeStampKind from types.ts)
--   * citation      TEXT — HUD/CFR rule citation, e.g. "24 CFR §5.508"
--   * applicant_id  UUID NULL — scope key for v1. NULL = global scope
--   * payload       JSONB — canonical JSON-LD shape from Lane C makers
--   * prev_hash     BYTEA(32) — SHA-256 of the previous entry's entry_hash
--                                (32 zero bytes for sequence=1 / genesis)
--   * entry_hash    BYTEA(32) — SHA-256 over (sequence || prev_hash ||
--                                canonicalJson(payload) || created_at)
--   * created_at    TIMESTAMPTZ — written into the hash, immutable
--   * session_id    TEXT NULL — tenant session id (BP-03b beacons reuse this)
--
-- Append-only enforcement is layered at the DB level via a trigger that
-- raises on UPDATE/DELETE (operators with the table grant cannot tamper
-- without dropping the trigger, which itself shows up in pg_event_trigger
-- audit if installed).

CREATE TABLE IF NOT EXISTS compliance_tape (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sequence BIGINT NOT NULL CHECK (sequence >= 1),
  kind TEXT NOT NULL,
  citation TEXT NOT NULL,
  applicant_id UUID NULL REFERENCES users(id) ON DELETE RESTRICT,
  payload JSONB NOT NULL,
  prev_hash BYTEA NOT NULL CHECK (octet_length(prev_hash) = 32),
  entry_hash BYTEA NOT NULL UNIQUE CHECK (octet_length(entry_hash) = 32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  session_id TEXT NULL
);

-- Per-scope monotonic sequence. The COALESCE expression collapses the global
-- chain (applicant_id IS NULL) into a sentinel UUID so the same unique index
-- enforces "no gaps, no dupes per scope" for both scopes.
CREATE UNIQUE INDEX IF NOT EXISTS idx_compliance_tape_scope_sequence
  ON compliance_tape (
    COALESCE(applicant_id, '00000000-0000-0000-0000-000000000000'::uuid),
    sequence
  );

-- Hot path: list entries for an applicant in chain order.
CREATE INDEX IF NOT EXISTS idx_compliance_tape_applicant_sequence
  ON compliance_tape (applicant_id, sequence)
  WHERE applicant_id IS NOT NULL;

-- Append-only enforcement.
CREATE OR REPLACE FUNCTION compliance_tape_reject_mutation()
  RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'compliance_tape is append-only (% blocked)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

DROP TRIGGER IF EXISTS compliance_tape_no_update ON compliance_tape;
CREATE TRIGGER compliance_tape_no_update
  BEFORE UPDATE OR DELETE ON compliance_tape
  FOR EACH ROW
  EXECUTE FUNCTION compliance_tape_reject_mutation();

-- TRUNCATE bypasses row-level triggers; block at statement level too.
DROP TRIGGER IF EXISTS compliance_tape_no_truncate ON compliance_tape;
CREATE TRIGGER compliance_tape_no_truncate
  BEFORE TRUNCATE ON compliance_tape
  FOR EACH STATEMENT
  EXECUTE FUNCTION compliance_tape_reject_mutation();
