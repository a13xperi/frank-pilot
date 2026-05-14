-- Application Messages migration (2026-05-14)
-- Adds two-way thread between staff and applicant/tenant for a given
-- application. Drives the "My Application" tenant-portal page and the
-- messaging panel on the staff ApplicationDetail page.

CREATE TABLE IF NOT EXISTS application_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  sender_user_id UUID NOT NULL REFERENCES users(id),
  sender_role TEXT NOT NULL CHECK (sender_role IN ('staff','applicant','tenant')),
  body TEXT NOT NULL CHECK (length(trim(body)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_application_messages_app_created
  ON application_messages(application_id, created_at DESC);
