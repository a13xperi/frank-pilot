-- Unit-identity Phase B (5/7): re-anchor the transaction tables to the unit.
-- The unit is the durable spine; application_id stays (a tenancy is an *episode*
-- on a unit). unit_id is nullable + backfillable (WS-4) from
-- applications.claimed_unit_id.
--
-- NOTE: audit_log is append-only (prevent_audit_modification trigger rejects
-- row UPDATE/DELETE), so its unit_id is FORWARD-ONLY — set at INSERT going
-- forward; existing rows cannot be backfilled and stay NULL. The five mutable
-- tables below CAN be backfilled. ADD COLUMN is metadata-only DDL (the row-level
-- trigger does not fire), so adding the column to audit_log is safe.
-- ON DELETE SET NULL so a unit delete never orphans durable history.
ALTER TABLE tenant_ledger    ADD COLUMN IF NOT EXISTS unit_id UUID REFERENCES units(id) ON DELETE SET NULL;
ALTER TABLE recertifications ADD COLUMN IF NOT EXISTS unit_id UUID REFERENCES units(id) ON DELETE SET NULL;
ALTER TABLE lease_violations ADD COLUMN IF NOT EXISTS unit_id UUID REFERENCES units(id) ON DELETE SET NULL;
ALTER TABLE lease_renewals   ADD COLUMN IF NOT EXISTS unit_id UUID REFERENCES units(id) ON DELETE SET NULL;
ALTER TABLE move_outs        ADD COLUMN IF NOT EXISTS unit_id UUID REFERENCES units(id) ON DELETE SET NULL;
ALTER TABLE audit_log        ADD COLUMN IF NOT EXISTS unit_id UUID REFERENCES units(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tenant_ledger_unit    ON tenant_ledger(unit_id);
CREATE INDEX IF NOT EXISTS idx_recertifications_unit ON recertifications(unit_id);
CREATE INDEX IF NOT EXISTS idx_lease_violations_unit ON lease_violations(unit_id);
CREATE INDEX IF NOT EXISTS idx_lease_renewals_unit   ON lease_renewals(unit_id);
CREATE INDEX IF NOT EXISTS idx_move_outs_unit        ON move_outs(unit_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_unit        ON audit_log(unit_id);
