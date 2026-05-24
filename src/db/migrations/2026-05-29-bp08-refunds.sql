-- BP-08 hardening: Stripe refunds.
--
-- Completes the money lifecycle. A staff-initiated refund (POST
-- /api/payments/refunds) asks Stripe to refund; the `charge.refunded` webhook
-- confirms it and posts an OFFSETTING ledger entry (entry_type 'refund',
-- positive amount, restoring the balance the original payment reduced).
--
-- Three concerns, all idempotent so this migration is safe to re-apply:
--   1. ledger_entry_type gains 'refund'.
--   2. audit_action gains the refund-lifecycle actions.
--   3. payment_idempotency tracks the refund (id, amount, status) + an index
--      on payment_intent_id (the refunds route + webhook both look up by it).
--
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block; the migration
-- runner applies these statements in autocommit (no explicit BEGIN/COMMIT), same
-- as 2026-05-27-bp08-audit-action-enum.sql. The ALTER TABLE / CREATE INDEX
-- statements below are likewise autocommit-safe.

ALTER TYPE ledger_entry_type ADD VALUE IF NOT EXISTS 'refund';

ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'payment_refund_requested';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'payment_refunded';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'ledger_refund_recorded';

ALTER TABLE payment_idempotency ADD COLUMN IF NOT EXISTS refund_id TEXT;
ALTER TABLE payment_idempotency ADD COLUMN IF NOT EXISTS refunded_amount_cents INT;
ALTER TABLE payment_idempotency ADD COLUMN IF NOT EXISTS refund_status TEXT;

CREATE INDEX IF NOT EXISTS idx_payment_idempotency_intent
  ON payment_idempotency (payment_intent_id);
