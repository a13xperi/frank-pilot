-- BP-02 Compliance Tape — fix for Lane B/Lane A mismatch
--
-- The repository's `insert()` uses
--   INSERT ... ON CONFLICT (kind, session_id) DO NOTHING
-- to provide same-session idempotency (re-firing the same beacon for the same
-- session_id is a no-op). Lane A's migration shipped without a unique index
-- backing that clause, so the INSERT errors with
--   "there is no unique or exclusion constraint matching the ON CONFLICT
--    specification"
-- the first time the dual-write fires under COMPLIANCE_TAPE_V2_ENABLED.
--
-- Non-partial unique on (kind, session_id). PostgreSQL's default NULL semantics
-- treat each NULL as distinct, so stamps without a session_id remain insertable
-- as separate rows (no idempotency guarantee — that's intentional; callers that
-- want idempotency must provide a session_id). A partial index with a WHERE
-- predicate would force the ON CONFLICT clause to repeat the predicate verbatim,
-- which Lane B's INSERT does not — non-partial avoids that coupling.

CREATE UNIQUE INDEX IF NOT EXISTS idx_compliance_tape_kind_session
  ON compliance_tape (kind, session_id);
