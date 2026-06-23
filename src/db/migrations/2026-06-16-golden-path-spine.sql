-- Golden-path spine welds (call → text → magic link → walkthrough).
-- Additive + dark. Two seam fixes:
--   1. applications.conversation_id — lets a voice/SMS call self-link its draft
--      (kills the orphan/duplicate-app break; no PM-approve required to bind).
--   2. sms_sessions.user_id — the SMS-only path now creates a phone-keyed user
--      so an SMS-only resident has an auth path back (was a dead end).

ALTER TABLE applications ADD COLUMN IF NOT EXISTS conversation_id TEXT;
CREATE INDEX IF NOT EXISTS idx_applications_conversation
  ON applications (conversation_id);

-- NOTE: seam #2 (sms_sessions.user_id) is applied in 2026-06-16-sms-sessions.sql,
-- co-located with the table create, because the runner applies migrations in
-- filename order and this file (golden-path-spine) sorts BEFORE sms-sessions —
-- so an ALTER here would hit a not-yet-created table on a fresh DB.
