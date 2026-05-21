-- Add FK index on application_messages.sender_user_id (PR #4 follow-up P0 #4)
-- Reverse-lookup queries (staff offboarding, user → messages, deletions)
-- otherwise table-scan once message volume grows.

CREATE INDEX IF NOT EXISTS idx_application_messages_sender
  ON application_messages(sender_user_id);
