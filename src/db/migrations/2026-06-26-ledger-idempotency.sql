-- Idempotency for Stripe-driven ledger entries (PER-579).
--
-- reference_id is the Stripe payment-intent / refund id. It is unique per REAL
-- entry: reversals link via reversed_by_id (not by reusing reference_id), and
-- refunds carry their OWN refund id. So a duplicate reference_id is a double-post
-- — the exact bug a redelivered or concurrent Stripe webhook causes.
--
-- This partial unique index lets recordPayment/recordRefund use ON CONFLICT DO
-- NOTHING, making them idempotent: a second post of the same reference_id is a
-- no-op and the caller re-fetches the original. NULL reference_id rows (rent,
-- fees, manual adjustments) are excluded, so they are unaffected.
--
-- SAFETY: if this migrate step fails because prod already holds duplicate
-- reference_ids, that is the signal — a failed migrate is NO downtime (the
-- running version stays live on Railway). Dedup the true double-posts, then
-- redeploy. See docs/LEDGER-IDEMPOTENCY-SPEC.md (battlestation) for the dup-check.

CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_reference_unique
  ON tenant_ledger (reference_id) WHERE reference_id IS NOT NULL;
