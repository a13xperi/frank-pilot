-- 2026-06-01 fcra-consent (consumer-report authorization capture)
--
-- FCRA §1681b(b)(2)(A): before a person procures a consumer report on an
-- individual, that individual must be given a clear-and-conspicuous written
-- disclosure and must provide written authorization. In the applicant-mediated
-- CRA flow (Checkr background + TransUnion ShareAble credit, dark behind
-- CONSUMER_REPORT_ENABLED — see 2026-06-01-applications-consumer-report.sql),
-- the CRA hosts its own KBA + completion, but FRANK is the END USER procuring
-- the report and therefore owes the §1681b(b)(2) disclosure + authorization
-- itself. Today submit() stamps `screening_authorization_at = NOW()` at
-- order-creation WITHOUT ever capturing an authorization — a compliance gap.
-- This migration adds the durable authorization record that gates the pull.
--
-- We persist the evidentiary trail (who, when, which disclosure version, a
-- SHA-256 hash of the exact disclosure text shown, capture method, IP, UA) —
-- the same shape as the ESIGN/UETA `lease_signatures` record. One authorization
-- per application: `application_id` is UNIQUE and writes are ON CONFLICT DO
-- NOTHING, so the FIRST authorization wins and re-submits are idempotent.
--
-- NOTE: ALTER TYPE ... ADD VALUE cannot run inside a transaction block.
-- Apply this file OUTSIDE a transaction, e.g.:
--   psql "$DATABASE_URL" -f src/db/migrations/2026-06-01-fcra-consent.sql
-- (Do NOT wrap in BEGIN/COMMIT; do NOT run via a migration runner that opens a txn.)

ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'consumer_report_authorized';

CREATE TABLE IF NOT EXISTS consumer_report_authorizations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id     UUID NOT NULL UNIQUE,
  applicant_id       UUID,
  applicant_role     TEXT,
  disclosure_version TEXT NOT NULL,
  disclosure_hash    TEXT NOT NULL,
  method             TEXT NOT NULL DEFAULT 'in_app_checkbox',
  authorized_ip      TEXT,
  user_agent         TEXT,
  authorized_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
