-- Voice verification + caller history (Phase 2 in-call server tools).
--
-- Backs the two ElevenLabs Conv. AI server tools the voice agent (Frank) calls
-- mid-call, both flag-gated behind VOICE_VERIFICATION_ENABLED:
--   send_verification    — mints a short numeric code + a tenant-portal
--                          magic-link, texts both, and stores the code here
--                          server-side (hashed) for read-back confirmation.
--   get_caller_history   — summarizes prior voice_intake_calls for a resolved
--                          caller; reads the verified flag here as
--                          defense-in-depth (the identity GATE itself is
--                          enforced in the agent PROMPT, per product design).
--
-- One row per (conversation_id) verification attempt. The code is NEVER stored
-- in the clear — only its SHA-256 hash, exactly like magic_link_tokens.token_hash.
-- PII-minimal: full phone is kept (we must text it back) but is the only PII;
-- applicant_id is the application/user reference, no name lands here.
--
-- Idempotent: CREATE TABLE/INDEX IF NOT EXISTS only, no enums, no ALTER TYPE.
-- Re-running this migration is a guaranteed no-op (the migrate-check CI job
-- asserts this).

CREATE TABLE IF NOT EXISTS voice_verification_codes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id TEXT NOT NULL,          -- ElevenLabs conversation_id (the key the tools pass)
  code_hash       TEXT NOT NULL,          -- SHA-256 of the numeric code; never the raw code
  phone           TEXT,                   -- E.164 the code/link was texted to
  applicant_id    UUID,                   -- resolved applications/users reference; NULL if unknown
  expires_at      TIMESTAMPTZ NOT NULL,   -- ~10 min TTL from issue
  used_at         TIMESTAMPTZ,            -- set when the code is successfully read back
  attempts        INTEGER NOT NULL DEFAULT 0,  -- read-back attempts against this code
  verified_at     TIMESTAMPTZ,            -- set on first successful verify (defense-in-depth flag)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- get_caller_history checks "is this conversation verified?" and the verify
-- step looks up the latest live code for a conversation — both keyed on
-- conversation_id, newest first.
CREATE INDEX IF NOT EXISTS idx_voice_verification_codes_conversation
  ON voice_verification_codes (conversation_id, created_at DESC);

-- Stuck/expired-code sweep + attempt-rate triage.
CREATE INDEX IF NOT EXISTS idx_voice_verification_codes_expires
  ON voice_verification_codes (expires_at);
