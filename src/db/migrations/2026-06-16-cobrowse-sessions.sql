-- Concierge co-browse sessions (Phase 2 — DARK scaffold).
--
-- One row per "Frank, fill out the application with me" hand-off. Mid-call (or
-- mid-chat) the agent offers to co-pilot the /apply wizard: we mint a one-time
-- viewer token, text the applicant a link to a live screencast of the form
-- being filled, capture explicit consent, and (eventually) drive the wizard
-- with a computer-use loop. THE LIVE DRIVING LOOP IS NOT WIRED YET — this
-- table + the runtime/orchestrator.ts class are a compiling, fail-closed
-- scaffold pending counsel sign-off. Everything is gated behind
-- COBROWSE_ENABLED (default false) so nothing here is reachable in prod.
--
-- Security / consent posture (the audit anchors that make this defensible):
--   - viewer_token_hash is sha256(raw_token) — the raw token only ever lives
--     in the SMS link, never at rest (mirrors auth/magic-link-service.ts).
--   - viewer_token_used_at + expires_at make the viewer link single-use and
--     short-lived.
--   - consent_captured_at records the affirmative "yes, co-browse with me"
--     (HUD 4350.3 Ch. 4-6 capture + NRS 200.620 two-party recording + TCPA
--     47 CFR §64.1200 for the SMS).
--   - confirmed_at records the applicant's final "yes, submit this" before any
--     irreversible action — the wizard is never submitted without it.
--
-- PII-minimal: no name, SSN, DOB, or full phone lands here. The form values
-- the orchestrator fills live transiently in memory inside the (stubbed)
-- runtime; only field-fill COUNTS and lifecycle state are persisted.
--
-- state machine:
--   created → viewer_connected → driving → awaiting_confirm → confirmed
--                                                            → handed_off
--   any → denied | expired | aborted | error

CREATE TABLE IF NOT EXISTS cobrowse_sessions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id      TEXT NOT NULL,
  application_id        UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewer_token_hash    TEXT NOT NULL,
  viewer_token_used_at TIMESTAMPTZ,
  expires_at           TIMESTAMPTZ NOT NULL,
  state                VARCHAR(24) NOT NULL DEFAULT 'created'
    CHECK (state IN (
      'created','viewer_connected','driving','awaiting_confirm','confirmed',
      'handed_off','denied','expired','aborted','error'
    )),
  deny_reason          VARCHAR(40),
  agent_model          TEXT,
  fields_filled        INT NOT NULL DEFAULT 0,
  consent_captured_at  TIMESTAMPTZ,
  confirmed_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ DEFAULT now()
);

-- Post-call webhook / viewer-route lookups bind by conversation_id; the
-- application_id index supports the "is there already a co-browse for this
-- draft?" find-or-create path.
CREATE INDEX IF NOT EXISTS idx_cobrowse_sessions_conversation_id
  ON cobrowse_sessions (conversation_id);
CREATE INDEX IF NOT EXISTS idx_cobrowse_sessions_application_id
  ON cobrowse_sessions (application_id);
