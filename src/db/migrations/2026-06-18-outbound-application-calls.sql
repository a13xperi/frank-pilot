-- Outbound full-application agent queue (Frank core C3, "Jacqueline") — 2026-06-18
--
-- Jacqueline is the OUTBOUND agent that calls an applicant back to finish their
-- full application over the phone (vs the inbound intake and vs the C-029
-- waitlist *validation* dialer, which only confirms interest). Mid-call she
-- fills application fields via server tools and submits the draft.
--
-- ⚠ SCOPE / DEFERRAL: this migration is the SERVER-SIDE SCAFFOLDING ONLY — the
-- queue + the conversation↔application map + the safety substrate. It deliberately
-- does NOT include, and this slice does NOT build:
--   - a live ElevenLabs outbound agent / agent_id (a console artifact)
--   - any real dial (no ElevenLabs/Twilio outbound-call from this code)
--   - DID / phone-number routing
-- Those are gated, manual, live-integration steps (see the deferral note in the
-- C3 service). This table mirrors outbound_validation_calls so the eventual
-- dialer can reuse the exact same concurrency-1 / batch-cap / pacing gates.
--
-- PII-minimal: name + full phone never land here. We key on the LOCAL
-- applications.id (the draft being completed) + last-4 for log triage; the
-- transcript/structured results live on the post-call webhook target.

CREATE TABLE IF NOT EXISTS outbound_application_calls (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The application draft this call is completing. FK to the local table (these
  -- are OUR drafts, unlike the validation dialer which keys Sage applicants).
  application_id     UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  conversation_id    TEXT UNIQUE,            -- NULL until/unless a real call starts
  call_sid           TEXT,
  to_number_last4    TEXT,
  test_call          BOOLEAN NOT NULL DEFAULT FALSE,
  -- queued  : eligible, not yet attempted
  -- dialed  : a call is in flight (set ONLY by the deferred live dialer)
  -- completed / no_answer / failed / canceled : terminal
  status             TEXT NOT NULL DEFAULT 'queued'
                       CHECK (status IN ('queued','dialed','completed','no_answer','failed','canceled')),
  attempts           SMALLINT NOT NULL DEFAULT 0,
  outcome            TEXT,
  -- Snapshot of which fields still need collecting at enqueue time (advisory;
  -- the tool handlers re-read the live draft before writing).
  needed_fields      JSONB NOT NULL DEFAULT '[]',
  dynamic_variables  JSONB NOT NULL DEFAULT '{}',
  error              TEXT,
  queued_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dialed_at          TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- At most one OPEN (queued|dialed) call per application — prevents two
  -- Jacqueline calls racing to complete the same draft.
  CONSTRAINT uq_outbound_application_open UNIQUE (application_id, status)
);

-- Claim path: oldest queued first.
CREATE INDEX IF NOT EXISTS idx_outbound_application_calls_queued
  ON outbound_application_calls (status, queued_at)
  WHERE status = 'queued';

-- In-flight / sweep path.
CREATE INDEX IF NOT EXISTS idx_outbound_application_calls_dialed
  ON outbound_application_calls (status, dialed_at);
