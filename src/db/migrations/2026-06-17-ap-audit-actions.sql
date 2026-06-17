-- DM-FRANK-024 Accounts Payable — audit_action enum extension.
-- Fresh databases get these values (plus the ap_* enums and tables) via
-- schema.ts SCHEMA_SQL, which is idempotent and applied every migrate run.
-- This delta adds the 9 AP lifecycle actions to the EXISTING audit_action enum
-- on already-provisioned databases (a guarded CREATE TYPE can't extend an enum
-- that already exists).
--
-- NOTE: `ALTER TYPE ... ADD VALUE` cannot run inside an explicit transaction;
-- applied via psql autocommit (see migrate.ts), same as 2026-05-22-lease-esign.sql.

ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'ap_vendor_registered';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'ap_invoice_captured';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'ap_check_cut';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'ap_check_reviewed';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'ap_check_rejected';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'ap_check_signed';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'ap_check_disbursed';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'ap_check_voided';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'ap_check_reissued';
