-- BP-08 pre-flip-on audit fix (L1.1 finding 1): foreign key on
-- payment_idempotency.application_id.
--
-- The original BP-08 table (2026-05-25-bp08-payment-tables.sql) declared
-- application_id as a bare UUID NOT NULL with no referential integrity. A
-- deleted application would orphan its idempotency rows, and a typo'd
-- application_id would silently persist. applications(id) is UUID, so the
-- column types already match — we only need the constraint.
--
-- ON DELETE CASCADE: if an application is removed, its payment-replay rows go
-- with it. There is no value in retaining replay protection for an application
-- that no longer exists, and the cascade keeps the table from accumulating
-- dangling keys.
--
-- Guarded with a catalog check so a re-run (or a fresh DB where the constraint
-- name is already present) is a no-op rather than an error.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'payment_idempotency_application_id_fkey'
  ) THEN
    ALTER TABLE payment_idempotency
      ADD CONSTRAINT payment_idempotency_application_id_fkey
        FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE;
  END IF;
END
$$;
