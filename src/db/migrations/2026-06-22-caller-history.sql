-- Returning-caller memory (inbound-voice continuity).
--
-- Once a caller clears the PIN gate (validation_pins), Frank's inbound voice
-- agent can pick up where the last call left off instead of restarting cold.
-- This table is the per-number rollup the in-call tool reads to greet a
-- returning caller and recall their prior context: the apartment type they were
-- tracking, how the last call ended, the one open thread, the city cue, and
-- whether a callback is owed. The post-call webhook upserts the row.
--
-- One row per number (`phone_e164` UNIQUE): `call_count`, `first_call_at` and
-- `latest_call_at` track recognition + recency, and the `prior_*` columns
-- snapshot the last call's coarse substance.
--
-- PII-MINIMAL by design: no caller name, no income, no household composition and
-- no verbatim transcript land here. That detail already lives — append-only,
-- consent-gated, audit-taped — in `voice_intake_calls`; this table is only the
-- thin recognition + rapport cache the next call needs. Column set is the
-- contract `src/modules/caller-history/service.ts` reads/writes; keep them in
-- lockstep.

CREATE TABLE IF NOT EXISTS caller_history (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164                TEXT NOT NULL UNIQUE,
  call_count                INTEGER NOT NULL DEFAULT 0,
  first_call_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  latest_call_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  prior_outcome             VARCHAR(16),   -- last call_successful: success | failure | unknown
  prior_apt_type            VARCHAR(32),   -- coarse apartment-type cue, eg "2BR"
  prior_issue               TEXT,          -- short last open-thread summary
  prior_city                TEXT,          -- current city cue
  prior_callback_requested  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The in-call tool and post-call webhook both look the caller up by number.
CREATE INDEX IF NOT EXISTS idx_caller_history_phone_e164
  ON caller_history (phone_e164);

-- Recency-ordered scans (most-recent returning callers first).
CREATE INDEX IF NOT EXISTS idx_caller_history_latest
  ON caller_history (latest_call_at DESC);
