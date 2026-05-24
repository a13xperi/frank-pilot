-- Demo/usability harness — tag accounts created during a `?demo=<TOKEN>`
-- walkthrough so they can be (a) excluded from PM signup metrics and (b)
-- reaped wholesale by scripts/purge-demo-data.mjs after a test round.
--
-- Idempotent. Mirrors the demo_run_id column added to the users block in
-- schema.ts. The value is the per-tab runId minted client-side and echoed to
-- the register call; NULL for every real signup.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS demo_run_id TEXT;

-- Partial index: demo rows are a tiny minority, and both the metrics filter
-- (WHERE demo_run_id IS NULL) and the purge (WHERE demo_run_id = $1) only ever
-- care about the populated rows.
CREATE INDEX IF NOT EXISTS idx_users_demo_run_id
  ON users(demo_run_id)
  WHERE demo_run_id IS NOT NULL;
