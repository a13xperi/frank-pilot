-- Relationship Report — the running per-person summary, the CRM record of the
-- relationship. Derived (refreshed) from the relationship_ledger + the person's
-- latest application on every ledger write. One fast row to read for "where does
-- this person stand overall" — Frank recites it on re-entry, operators read it
-- on the people board. Keyed by phone (+ nullable person_slug bridge).
-- Idempotent: CREATE ... IF NOT EXISTS only.

CREATE TABLE IF NOT EXISTS relationship_report (
  phone_e164     TEXT PRIMARY KEY,
  person_slug    TEXT,
  summary        TEXT,                 -- the human one-liner
  interactions   INTEGER NOT NULL DEFAULT 0,
  last_status    TEXT,                 -- latest application status
  last_event     TEXT,                 -- latest ledger event_type
  last_event_at  TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
