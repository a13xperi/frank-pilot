-- Lease e-signature (native, tenant-facing) — BP lease-esign
-- Inserts a `lease_signed` status between `lease_generated` and `onboarded`,
-- adds the matching audit_action, and a `lease_signatures` ledger table.
--
-- NOTE: `ALTER TYPE ... ADD VALUE` cannot run inside a transaction that then
-- uses the new value, and Postgres < 12 cannot ADD VALUE in a txn at all.
-- Run these statements outside an explicit BEGIN/COMMIT (psql autocommit).

ALTER TYPE application_status ADD VALUE IF NOT EXISTS 'lease_signed' BEFORE 'onboarded';
ALTER TYPE audit_action      ADD VALUE IF NOT EXISTS 'lease_signed';

CREATE TABLE IF NOT EXISTS lease_signatures (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  application_id      UUID NOT NULL UNIQUE REFERENCES applications(id) ON DELETE CASCADE,
  signer_user_id      UUID NOT NULL REFERENCES users(id),
  signer_name         TEXT NOT NULL,
  signature_image     TEXT NOT NULL,
  signed_document_url TEXT,
  document_hash       TEXT,
  signer_ip           INET,
  consent_at          TIMESTAMPTZ NOT NULL,
  signed_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
