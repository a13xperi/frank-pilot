-- 2026-07-02 consent-evidence (audit C4 — voice consent evidence chain)
--
-- A voice tool call carries only a caller-controlled `consent_acknowledged`
-- boolean, so a forged/replayed tool call (see audit C3) — or an over-eager
-- agent — could mint a "valid" FCRA authorization that satisfies the C2
-- screening gate with no evidence the §1681b disclosure was ever read.
--
-- This migration adds the evidence chain:
--   * conversation_id — anchors a voice-minted authorization to the
--     ElevenLabs conversation that minted it (reviewers reach the recorded
--     call via voice_intake_calls.transcript_url on the same id).
--   * method 'voice_verbal_unverified' (written by the voice tools from now
--     on) marks consent asserted by the tool boolean but not yet evidenced.
--   * When the post-call webhook delivers the transcript, the turns are
--     checked for the read disclosure + the caller's affirmative
--     (consumer-report-consent.ts verifyVoiceAuthorizationForConversation);
--     on a match the row upgrades to method 'voice_verbal_verified' with
--     verified_at + verification_evidence (matcher id, matched snippets).
--     No match → the row STAYS unverified, the honest reviewable state.
--
-- Pre-existing rows with method='voice_verbal' were minted by the same
-- caller-controlled boolean but their calls are long over (no webhook will
-- re-deliver a transcript). They are deliberately NOT retagged here —
-- rewriting recorded consent evidence is an operator/counsel decision, and
-- the method value already identifies them for review.
--
-- NOTE: ALTER TYPE ... ADD VALUE cannot run inside a transaction block.
-- Apply this file OUTSIDE a transaction, e.g.:
--   psql "$DATABASE_URL" -f src/db/migrations/2026-07-02-consent-evidence.sql
-- (Do NOT wrap in BEGIN/COMMIT; do NOT run via a migration runner that opens a txn.)

ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'consumer_report_consent_verified';

ALTER TABLE consumer_report_authorizations
  ADD COLUMN IF NOT EXISTS conversation_id TEXT,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verification_evidence JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_consumer_report_auth_conversation
  ON consumer_report_authorizations(conversation_id)
  WHERE conversation_id IS NOT NULL;
