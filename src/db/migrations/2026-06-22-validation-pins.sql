-- Caller PIN-verification challenges (inbound-voice identity gate).
--
-- Before Frank's inbound voice agent reads back any caller-specific history or
-- acts on a returning caller, it issues a short-lived numeric PIN challenge to
-- confirm the person on the line owns the number. The PIN is delivered out of
-- band (SMS) and never stored in the clear — only a salted hash lands here, so
-- a leak of this table can't be replayed into a verification.
--
-- One row per challenge: `attempt_count` is bumped on each wrong guess and the
-- gate fails closed once it reaches `max_attempts`; `expires_at` (10 min)
-- caps the live window so an unanswered challenge can't be brute-forced later.
-- `conversation_id` ties the challenge back to the ElevenLabs call once issued.
--
-- PII-minimal: no PIN plaintext, no name — just the E.164 number, the hash, and
-- the verification lifecycle the in-call tool reads on each attempt.

CREATE TABLE IF NOT EXISTS validation_pins (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164       TEXT NOT NULL,
  pin_hash         TEXT NOT NULL,            -- salted hash, never the plaintext PIN
  pin_salt         TEXT NOT NULL,
  conversation_id  TEXT,                     -- ElevenLabs call, set once challenge is issued
  attempt_count    INT NOT NULL DEFAULT 0,
  max_attempts     INT NOT NULL DEFAULT 3,
  verified_at      TIMESTAMPTZ,
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'verified', 'expired')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at       TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '10 minutes'
);

-- The in-call tool loads the live pending challenge for a number on each attempt.
CREATE INDEX IF NOT EXISTS idx_validation_pins_phone_e164_status
  ON validation_pins (phone_e164, status);
