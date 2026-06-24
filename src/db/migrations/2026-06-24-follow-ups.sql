-- Frank follow-ups (scheduled callbacks + the relationship spine).
--
-- When Frank reaches someone at a bad time, or a thread needs a callback, he
-- schedules a follow-up here; a cron tick (Phase 2) claims due rows and dials
-- the callback within the same safety rails as the outbound-validation dialer.
-- Generalises the dead-end `voice_intake_calls.callback_requested` boolean into
-- a scheduled, context-rich, retried record.
--
-- Person model is PHONE-KEYED (the canonical voice identifier) with a nullable
-- `person_slug` so a later universal-CRM bridge to comms_identities is a join,
-- never a rewrite. Idempotent: CREATE ... IF NOT EXISTS only.

CREATE TABLE IF NOT EXISTS follow_ups (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164                TEXT NOT NULL,
  user_id                   UUID,                 -- nullable FK users.id
  voice_call_id             TEXT,                 -- originating conversation_id
  person_slug               TEXT,                 -- bridge to comms_identities (backfilled later)
  reason                    TEXT NOT NULL,        -- bad_time | no_answer | needs_info | callback_requested
  scheduled_for             TIMESTAMPTZ NOT NULL,
  status                    TEXT NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','in_progress','completed','declined','no_answer','expired')),
  attempts                  INTEGER NOT NULL DEFAULT 0,
  max_attempts              INTEGER NOT NULL DEFAULT 3,
  last_attempted_at         TIMESTAMPTZ,
  next_attempt_after        TIMESTAMPTZ,
  outbound_conversation_id  TEXT,                 -- the callback's conversation
  consent_outbound          BOOLEAN NOT NULL DEFAULT FALSE,
  notes                     TEXT,
  source                    TEXT,                 -- voice_intake | operator | ...
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The cron claims due, pending rows.
CREATE INDEX IF NOT EXISTS idx_follow_ups_due ON follow_ups (status, scheduled_for);
-- Per-person lookups (open loop, context packet).
CREATE INDEX IF NOT EXISTS idx_follow_ups_phone ON follow_ups (phone_e164);
