-- 2026-07-02 applications-conversation-unique (audit #3 — duplicate paid applications)
--
-- Real ElevenLabs server-tool bodies are flat (no tool_call_id), so the
-- generic tool-callback dedup keys a random UUID and never fires for a second
-- distinct create_application in the same call. With conversation_id only a
-- PLAIN index (2026-06-16-golden-path-spine.sql), a redelivered or duplicated
-- create minted a SECOND draft application — and, once Stripe is live, a
-- second $35.95 charge (the fee idempotencyKey is per-applicationId).
--
-- This makes conversation_id a partial UNIQUE so the second create hits
-- ON CONFLICT and the handler returns the existing application instead of a
-- duplicate. Rows with NULL conversation_id (the web apply wizard) are
-- unaffected — the partial predicate excludes them.
--
-- ⚠️ PRE-REQ: NO existing duplicates. `npm run cli -- applications-dup-report`
-- must show 0 before this deploys — the UNIQUE index build FAILS on dup data
-- (by design: it will not silently corrupt). Reconcile any dups first
-- (operator; check for paired Stripe charges before deleting a row).
--
-- Plain SQL (no ALTER TYPE) — safe under the tracked psql runner.

CREATE UNIQUE INDEX IF NOT EXISTS uq_applications_conversation_id
  ON applications (conversation_id)
  WHERE conversation_id IS NOT NULL;

-- The plain lookup index is now redundant (the unique index serves the same
-- conversation_id lookups). Drop it to avoid a duplicate index.
DROP INDEX IF EXISTS idx_applications_conversation;
