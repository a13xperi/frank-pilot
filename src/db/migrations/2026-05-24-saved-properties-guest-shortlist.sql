-- Saved-property shortlist + server-side guest sessions — 2026-05-24
--
-- "Save property → temporary guest profile → Airbnb-style shortlist → convert
-- to full account." Guests can't live in `users` (email/first_name/last_name
-- are NOT NULL + email UNIQUE), so an anonymous saver gets a server-side
-- `guest_sessions` row keyed by an opaque httpOnly cookie. On magic-link
-- account creation the guest's saved list is re-pointed onto the real user.
--
-- A saved row belongs to EXACTLY ONE owner — a guest session OR a user, never
-- both, never neither (CHECK below). On conversion we flip guest_session_id →
-- user_id, so the same row migrates without being re-inserted.

-- ── Guest sessions ──────────────────────────────────────────────────────────
-- One row per anonymous browser. `token_hash` is sha256() of the opaque cookie
-- token (the raw token is never stored). `converted_user_id` is stamped once
-- the guest registers, so we can both audit the conversion and short-circuit
-- re-migration (idempotent). `demo_run_id` mirrors users.demo_run_id so a
-- `?demo=<TOKEN>` walkthrough's guest can be reaped by scripts/purge-demo-data.
CREATE TABLE IF NOT EXISTS guest_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  token_hash VARCHAR(64) UNIQUE NOT NULL,
  converted_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  demo_run_id TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_guest_sessions_converted_user
  ON guest_sessions(converted_user_id);

-- ── Saved properties (shortlist) ────────────────────────────────────────────
-- Exactly one of (guest_session_id, user_id) is non-null — enforced by the
-- CHECK. Both FKs cascade so deleting a guest session or a user reaps their
-- shortlist. `list_name` gives Airbnb-style wishlists (default "My list").
-- `alert_enabled` is the per-item vacancy-alert toggle.
CREATE TABLE IF NOT EXISTS saved_properties (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  guest_session_id UUID NULL REFERENCES guest_sessions(id) ON DELETE CASCADE,
  user_id UUID NULL REFERENCES users(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  list_name TEXT NOT NULL DEFAULT 'My list',
  alert_enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT saved_properties_exactly_one_owner CHECK (
    (guest_session_id IS NOT NULL AND user_id IS NULL)
    OR (guest_session_id IS NULL AND user_id IS NOT NULL)
  )
);

-- Partial-unique indexes: a given property can't be double-saved per owner per
-- list. Two partials (one per owner column) because the owner is split across
-- two nullable columns — a single composite unique over a coalesced owner isn't
-- expressible without a generated column.
CREATE UNIQUE INDEX IF NOT EXISTS uq_saved_properties_guest
  ON saved_properties(guest_session_id, property_id, list_name)
  WHERE guest_session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_saved_properties_user
  ON saved_properties(user_id, property_id, list_name)
  WHERE user_id IS NOT NULL;

-- Hot read paths: list a guest's or a user's shortlist.
CREATE INDEX IF NOT EXISTS idx_saved_properties_guest
  ON saved_properties(guest_session_id) WHERE guest_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_saved_properties_user
  ON saved_properties(user_id) WHERE user_id IS NOT NULL;
