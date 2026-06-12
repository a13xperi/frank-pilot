-- Outbound waitlist-validation call tracking (DM-FRANK-029).
--
-- Frank dials GPM Donna Louise wait-list applicants through ElevenLabs native
-- Twilio outbound; the applicant queue itself lives on the Sage Supabase
-- project (gpm_waitlist_applicants — service-role only, full PII stays there).
-- This local table is the conversation_id -> applicant_id map the post-call
-- webhook needs to record outcomes, plus the substrate for the dialer's
-- safety gates (concurrency-1 in-flight check, daily batch cap, pacing).
--
-- PII-minimal by design: applicant name and full phone number never land
-- here — only the Sage applicant UUID and the last 4 digits for log triage.

CREATE TABLE IF NOT EXISTS outbound_validation_calls (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  applicant_id       UUID NOT NULL,          -- Sage gpm_waitlist_applicants.id
  conversation_id    TEXT UNIQUE,            -- NULL for dry runs / failed dials
  call_sid           TEXT,
  to_number_last4    TEXT,
  test_call          BOOLEAN NOT NULL DEFAULT FALSE,
  status             TEXT NOT NULL CHECK (status IN ('dry_run','dialed','completed','expired','dial_failed')),
  outcome            TEXT,                   -- mapped gpm outcome once recorded
  dynamic_variables  JSONB NOT NULL DEFAULT '{}',
  error              TEXT,
  dialed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Drives the in-flight check, the daily-cap count, and the stuck-call sweep.
CREATE INDEX IF NOT EXISTS idx_outbound_validation_calls_status_dialed
  ON outbound_validation_calls (status, dialed_at);
