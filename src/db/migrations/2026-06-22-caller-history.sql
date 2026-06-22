-- Returning-caller memory (inbound-voice continuity).
--
-- Once a caller clears the PIN gate (validation_pins), Frank's inbound voice
-- agent can pick up where the last call left off instead of restarting cold.
-- This table is the per-number rollup the in-call tool reads to greet a
-- returning caller and recall their prior context: which property and apartment
-- type they were tracking, how the last call ended, the open issues, and any
-- agent notes worth carrying forward. The post-call webhook upserts the row.
--
-- One row per number (`phone_e164` UNIQUE): `call_count` and `latest_call_at`
-- track recency, the `prior_*` columns snapshot the last call's substance, and
-- `summary_notes` / `last_agent_notes` carry the human-readable carryover.
-- `language` and `consent_recording` let the agent resume in the right language
-- and honor a prior recording choice without re-asking.
--
-- PII-minimal by design: no caller name lands here — only the E.164 number and
-- the conversational continuity the next call needs.

CREATE TABLE IF NOT EXISTS caller_history (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164         TEXT UNIQUE NOT NULL,
  call_count         INT NOT NULL DEFAULT 0,
  latest_call_at     TIMESTAMPTZ,
  prior_outcome      TEXT,                   -- how the last call ended
  prior_property     TEXT,
  prior_apt_type     TEXT,
  prior_issues       TEXT,
  summary_notes      TEXT,
  last_agent_notes   TEXT,
  language           TEXT,
  consent_recording  BOOLEAN,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The in-call tool and post-call webhook both look the caller up by number.
CREATE INDEX IF NOT EXISTS idx_caller_history_phone_e164
  ON caller_history (phone_e164);
