-- Multi-property inbound router (Frank core C4) — 2026-06-18
--
-- Frank is going from one property to many. An inbound contact (a call, an SMS,
-- a web "talk to Frank") arrives tagged with the property it originated from —
-- the DID it dialed, the QR/short-link it scanned, or the property page it was
-- on. This table maps each property to the voice agent that should handle it,
-- so the router can bucket the contact to the right agent + the right
-- per-property dynamic context.
--
-- SCOPE GUARD: this is the *mapping data + routing logic* only. It does NOT
-- touch the live phone number / IVR / ElevenLabs agent config — wiring a DID to
-- an agent is a console operation done by hand. This table is the lookup the
-- application consults once a contact is already in-process; populating it with
-- real agent IDs and pointing real DIDs at the app is a separate, manual,
-- gated step.

CREATE TABLE IF NOT EXISTS property_agent_routing (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id        UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  -- The ElevenLabs (or other) agent that handles this property's inbound
  -- contacts. Stored as an opaque string — we never call the agent from here,
  -- we only resolve which one owns the contact.
  agent_id           TEXT NOT NULL,
  -- Human label for the console ("Donna Louise 1 — inbound care").
  agent_label        TEXT,
  -- The inbound DID applicants dial for this property, E.164. Used by the
  -- router's by-DID path. NULL until a real number is assigned (manual).
  inbound_did_e164   TEXT,
  -- Optional channel scoping: which contact channels this row serves. Empty =
  -- all channels. e.g. {'voice'} for a voice-only agent, {'sms'} for text.
  channels           TEXT[] NOT NULL DEFAULT '{}',
  -- Routing precedence within a property (lower wins). Lets a property have a
  -- primary agent + fallbacks (e.g. an after-hours agent) without schema churn.
  priority           SMALLINT NOT NULL DEFAULT 100,
  -- Soft-disable a mapping without deleting it (keeps audit history).
  active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One active mapping per (property, agent, priority) — prevents accidental
  -- duplicate rows fighting for the same slot.
  UNIQUE (property_id, agent_id, priority)
);

-- by-property lookup (the dominant path): active rows for a property, best
-- priority first.
CREATE INDEX IF NOT EXISTS idx_property_agent_routing_property
  ON property_agent_routing (property_id, priority)
  WHERE active = TRUE;

-- by-DID lookup: an inbound call resolves the property+agent from the number it
-- dialed. Partial unique so a live DID maps to exactly one active agent.
CREATE UNIQUE INDEX IF NOT EXISTS uq_property_agent_routing_did_active
  ON property_agent_routing (inbound_did_e164)
  WHERE active = TRUE AND inbound_did_e164 IS NOT NULL;
