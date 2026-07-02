-- Backlog #17 — claim-path index for the Sage waitlist source of truth.
--
-- TARGET: the *Sage* Supabase project (GPM_SUPABASE_URL), NOT frank-pilot
-- Postgres. This file lives deliberately OUTSIDE src/db/migrations/ so the
-- boot migrator never runs it against the app DB (where the table does not
-- exist and boot would fail). Apply by pasting into the Sage Supabase SQL
-- editor — Alex-apply; see the PR body. Canonical schema:
-- battlestation schema/gpm-waitlist-sot.sql.
--
-- Why: gpm_claim_next_call() and the gpm_next_to_call view scan
-- gpm_waitlist_applicants every dialer tick (*/5 min, 9am–8pm PT) with
--
--   WHERE call_status IN ('pending','callback_requested')
--     AND consent_outbound
--     AND phone_e164 IS NOT NULL
--     AND (next_attempt_after IS NULL OR next_attempt_after <= now())
--     AND call_attempts < 3
--   ORDER BY asap DESC, first_added ASC
--   FOR UPDATE SKIP LOCKED LIMIT 1
--
-- and the only index today is the identity one → full scan + sort per tick,
-- growing with the waitlist. The partial index below matches the immutable
-- half of the predicate plus the exact sort order, so the claim becomes a
-- bounded ordered index scan. next_attempt_after compares against now()
-- (not immutable, so it cannot live in the index predicate) and stays a
-- filter — cheap, the partial predicate already prunes the candidate set.
--
-- Idempotent: IF NOT EXISTS; safe to re-paste.
CREATE INDEX IF NOT EXISTS gpm_waitlist_claim_idx
  ON public.gpm_waitlist_applicants (asap DESC, first_added ASC)
  WHERE call_status IN ('pending', 'callback_requested')
    AND consent_outbound
    AND phone_e164 IS NOT NULL
    AND call_attempts < 3;
