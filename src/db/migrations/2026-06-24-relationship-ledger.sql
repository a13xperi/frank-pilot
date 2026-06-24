-- Relationship Ledger — the applicant-facing "ledger of truth": every meaningful
-- step Frank takes for a person + every communication, append-only, person-centric.
--
-- Distinct from the internal audit `tape`: this is what we can SHOW the person
-- ("here's everything Frank did for you"), the source for the relationship report,
-- and the spine the lifelong-partner programs (energy/benefits) will extend onto.
-- Phone-keyed + nullable person_slug so the comms_identities bridge is a join.
-- Idempotent: CREATE ... IF NOT EXISTS only.

CREATE TABLE IF NOT EXISTS relationship_ledger (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164    TEXT NOT NULL,
  person_slug   TEXT,                  -- bridge to comms_identities (backfilled later)
  program       TEXT NOT NULL DEFAULT 'housing',  -- housing | energy | benefits | ...
  event_type    TEXT NOT NULL,         -- application_created | fee_paid | screening_started |
                                       -- id_verified | screening_passed | screening_failed |
                                       -- lease_ready | callback_scheduled | callback_made |
                                       -- email_sent | sms_sent | ...
  channel       TEXT NOT NULL DEFAULT 'system',   -- system | email | voice | sms
  direction     TEXT NOT NULL DEFAULT 'internal', -- inbound | outbound | internal
  summary       TEXT,                  -- the human one-liner shown back
  ref           TEXT,                  -- application_id | conversation_id | follow_up_id
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Per-person timeline read (the ledger + the context packet + the report).
CREATE INDEX IF NOT EXISTS idx_relationship_ledger_phone ON relationship_ledger (phone_e164, occurred_at DESC);
