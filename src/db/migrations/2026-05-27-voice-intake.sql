-- Voice intake (Phase 1 foundation)
--
-- Persists ElevenLabs Conv. AI post-call webhooks so a phone-only applicant
-- becomes a real `applications` row, with the same compliance-tape ledger
-- the web funnel uses. Schema mirrors the BP-08 payment webhook tables
-- (stripe_processed_events / stripe_webhook_dlq) so the proven idempotency
-- + DLQ pattern carries over verbatim — see src/modules/payment/webhook.ts.
--
-- Tables added:
--   voice_intake_calls        — one row per Conv. AI conversation
--   voice_intake_costs        — daily rollup of per-call cost telemetry
--   elevenlabs_processed_events  — webhook event_id dedupe (3-layer idem L2)
--   elevenlabs_webhook_dlq    — parked payloads when dispatch throws
--
-- Columns added to applications:
--   source                    — entry path (web|voice|sms|operator)
--   voice_call_id             — links back to voice_intake_calls.conversation_id
--   consent_outbound_ai_calls — TCPA PEWC flag (gates Phase 2 outbound)

BEGIN;

-- 1) Enum: application_source
-- CREATE TYPE has no IF NOT EXISTS; wrap so re-runs are no-ops.
DO $$ BEGIN
  CREATE TYPE application_source AS ENUM ('web', 'voice', 'sms', 'operator');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 2) applications columns
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS source application_source NOT NULL DEFAULT 'web';
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS voice_call_id TEXT;
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS consent_outbound_ai_calls BOOLEAN NOT NULL DEFAULT FALSE;

-- 3) voice_intake_calls
-- One row per ElevenLabs Conv. AI conversation. conversation_id is the
-- natural key (ElevenLabs-issued, globally unique per-conversation), so we
-- enforce it UNIQUE — the webhook handler uses it for L3 idempotency on the
-- applicant-create transition, beyond the L2 event_id dedupe below.
CREATE TABLE IF NOT EXISTS voice_intake_calls (
  id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id             TEXT NOT NULL UNIQUE,
  agent_id                    TEXT NOT NULL,
  started_at                  TIMESTAMPTZ NOT NULL,
  ended_at                    TIMESTAMPTZ,
  language                    VARCHAR(8),         -- BCP-47 (en / es)
  call_successful             VARCHAR(16),        -- success | failure | unknown
  evaluation_criteria_results JSONB NOT NULL DEFAULT '{}'::jsonb,
  data_collection_results     JSONB NOT NULL DEFAULT '{}'::jsonb,
  transcript_url              TEXT,
  audio_url                   TEXT,
  cost_breakdown              JSONB NOT NULL DEFAULT '{}'::jsonb,
  consent_recording           BOOLEAN NOT NULL DEFAULT TRUE,
  callback_requested          BOOLEAN NOT NULL DEFAULT FALSE,
  applicant_id                UUID REFERENCES applications(id) ON DELETE SET NULL,
  raw_payload                 JSONB,              -- full webhook body, debug + replay
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_voice_intake_calls_applicant
  ON voice_intake_calls(applicant_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_voice_intake_calls_started
  ON voice_intake_calls(started_at DESC);

CREATE INDEX IF NOT EXISTS idx_voice_intake_calls_callback_pending
  ON voice_intake_calls(started_at DESC)
  WHERE callback_requested = TRUE;

-- 4) voice_intake_costs (daily rollup)
-- Aggregated by date so the dashboard / Slack-budget alert is one cheap SELECT.
-- Per-call cost lives in voice_intake_calls.cost_breakdown for drill-down.
CREATE TABLE IF NOT EXISTS voice_intake_costs (
  date                DATE PRIMARY KEY,
  call_count          INTEGER NOT NULL DEFAULT 0,
  tts_chars           BIGINT  NOT NULL DEFAULT 0,
  asr_seconds         BIGINT  NOT NULL DEFAULT 0,
  llm_input_tokens    BIGINT  NOT NULL DEFAULT 0,
  llm_output_tokens   BIGINT  NOT NULL DEFAULT 0,
  convai_minutes      NUMERIC(12,2) NOT NULL DEFAULT 0,
  cost_usd            NUMERIC(10,4) NOT NULL DEFAULT 0,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5) elevenlabs_processed_events (L2 idempotency — exact analog of stripe_processed_events)
CREATE TABLE IF NOT EXISTS elevenlabs_processed_events (
  event_id        TEXT PRIMARY KEY,
  event_type      TEXT NOT NULL,
  conversation_id TEXT,
  processed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_elevenlabs_processed_conv
  ON elevenlabs_processed_events(conversation_id);

-- 6) elevenlabs_webhook_dlq (exact analog of stripe_webhook_dlq)
-- Soft-capped at 10k active rows in webhook.ts; this is a pressure-relief
-- valve, not a hard limit. Always 200 to ElevenLabs (retries here are
-- pointless — failures go here, not back to the wire).
CREATE TABLE IF NOT EXISTS elevenlabs_webhook_dlq (
  event_id        TEXT PRIMARY KEY,
  event_type      TEXT NOT NULL,
  raw_payload     JSONB NOT NULL,
  error_message   TEXT NOT NULL,
  attempt_count   INTEGER NOT NULL DEFAULT 1,
  first_failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_failed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_elevenlabs_dlq_active
  ON elevenlabs_webhook_dlq(last_failed_at DESC)
  WHERE attempt_count < 5;

COMMIT;
