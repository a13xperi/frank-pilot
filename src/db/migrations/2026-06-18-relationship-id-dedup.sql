-- Global relationship-ID dedup + waitlist→application graduation (Frank core C5)
-- 2026-06-18
--
-- THE PROBLEM: the same person sits on the waitlist for several Donna Louise
-- properties (and may already have an application elsewhere). Today each
-- application/waitlist row is an island — we can't see "this is the same human
-- across properties", which matters for fair-housing position tracking, for
-- not re-collecting the same docs, and for de-duping outreach.
--
-- THE KEY: a person is matched across properties by (normalized phone + DOB
-- hash). Both are things we already collect; neither is reversible here (we
-- store a SHA-256 of "<digits-only-phone>|<yyyy-mm-dd-dob>", never the raw DOB
-- — that stays in date_of_birth_encrypted). The hash is salted with the same
-- ENCRYPTION_KEY-derived secret as the rest of the PII layer (see
-- src/modules/waitlist-graduation/identity.ts) so the digest is useless without
-- the app secret.
--
-- person_identities is the cross-property anchor: one row per matched human,
-- carrying the relationship_id every island row points back to. applications
-- and waitlist_entries each gain a relationship_id FK so a join collapses an
-- individual's footprint to one identity.

-- ── person_identities: the global identity anchor ──────────────────────────
CREATE TABLE IF NOT EXISTS person_identities (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The match key: SHA-256 of "<phone_digits>|<dob_iso>", app-salted. UNIQUE so
  -- find-or-create is a single upsert and two rows can never describe the same
  -- (phone, DOB) pair.
  identity_hash   TEXT NOT NULL UNIQUE,
  -- Denormalized display/contact convenience (NOT the match key). Lets the
  -- relationship view show a name without joining every island row. Updated to
  -- the most recent non-null value as new rows attach.
  display_name    TEXT,
  phone_last4     TEXT,
  -- Soft signal of how many island rows resolve here (maintained by the
  -- service on attach; advisory, not a hard count).
  linked_count    INTEGER NOT NULL DEFAULT 0,
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── applications.relationship_id + dob_hash ────────────────────────────────
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS relationship_id UUID
    REFERENCES person_identities(id) ON DELETE SET NULL;

-- Per-row copy of the DOB component of the match key. Kept on the row (not just
-- the identity) so we can recompute / re-link without decrypting DOB, and so a
-- backfill can find rows that pre-date the identity layer.
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS dob_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_applications_relationship
  ON applications (relationship_id)
  WHERE relationship_id IS NOT NULL;

-- ── waitlist_entries.relationship_id ───────────────────────────────────────
-- waitlist_entries already joins to users(id); the relationship_id lets us
-- collapse a person's multi-property waitlist footprint to one identity, and is
-- carried onto the application draft at graduation time.
ALTER TABLE waitlist_entries
  ADD COLUMN IF NOT EXISTS relationship_id UUID
    REFERENCES person_identities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_waitlist_entries_relationship
  ON waitlist_entries (relationship_id)
  WHERE relationship_id IS NOT NULL;

-- ── graduation idempotency ─────────────────────────────────────────────────
-- A waitlist row graduates into at most one application draft. We record the
-- produced application on the waitlist row so a re-run is a no-op (the service
-- returns the existing application instead of minting a duplicate draft).
ALTER TABLE waitlist_entries
  ADD COLUMN IF NOT EXISTS graduated_application_id UUID
    REFERENCES applications(id) ON DELETE SET NULL;

ALTER TABLE waitlist_entries
  ADD COLUMN IF NOT EXISTS graduated_at TIMESTAMPTZ;
