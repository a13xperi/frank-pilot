-- Inbound SMS intake sessions (phone-first Frank, Phase 1).
--
-- A waitlist applicant can text Frank's number instead of using the web app
-- or calling the ElevenLabs voice agent. Each inbound thread is driven by a
-- tiny server-side state machine (src/modules/sms-intake/state-machine.ts)
-- that walks the same data_collection fields the voice intake collects
-- (name -> household -> income -> city), then promotes the conversation into
-- an `applications` draft (source 'sms') — the same compliance-tape funnel the
-- web/voice paths use.
--
-- One row per (phone, in-flight conversation). `collected` accumulates the
-- field answers as JSONB; `step` is the cursor into the walk; `status` tracks
-- the lifecycle so a completed/abandoned thread doesn't resume mid-flow. The
-- back-reference `application_id` is set once the draft is created on `done`.
--
-- Fail-closed: the whole feature is dark unless SMS_INTAKE_ENABLED=true. The
-- table is harmless to create ahead of the flag flip (mirrors the voice-intake
-- migration landing before VOICE_INTAKE_ENABLED).

CREATE TABLE IF NOT EXISTS sms_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164      TEXT NOT NULL,
  application_id  UUID,                 -- back-ref, set on `done` (applications.id)
  step            TEXT NOT NULL DEFAULT 'start'
                    CHECK (step IN ('start', 'name', 'household', 'income', 'city', 'done')),
  collected       JSONB NOT NULL DEFAULT '{}'::jsonb,
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'completed', 'abandoned')),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- The service loads the latest active session by phone on every inbound text.
CREATE INDEX IF NOT EXISTS idx_sms_sessions_phone_e164
  ON sms_sessions (phone_e164);
