-- Wait-list ingest + compliance sequencing (DM-FRANK-029)
-- Operator imports a property's wait-list export (e.g. OneSite) as an ordered
-- queue of prospects to contact, with a 48-hour response window per offer and a
-- 12-day overall window before removal. Kept separate from self-service
-- `waitlist_entries` (which is keyed to registered users): these are raw
-- prospects the agent works through, not yet platform users.

CREATE TABLE IF NOT EXISTS waitlist_import_batches (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id    UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  source         VARCHAR(50) NOT NULL DEFAULT 'onesite',
  file_name      TEXT,
  imported_count INT NOT NULL DEFAULT 0,
  imported_by    UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS waitlist_import_entries (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  batch_id             UUID NOT NULL REFERENCES waitlist_import_batches(id) ON DELETE CASCADE,
  property_id          UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  source_applicant_id  TEXT,
  first_name           TEXT,
  last_name            TEXT,
  phone                TEXT NOT NULL,
  email                TEXT,
  bedroom_count        SMALLINT,
  source_position      INT,
  source_date_added    TIMESTAMPTZ,
  position             INT NOT NULL,                 -- sequenced 1-based order within property
  status               VARCHAR(20) NOT NULL DEFAULT 'queued'
                         CHECK (status IN ('queued','offered','responded','removed','expired')),
  offered_at           TIMESTAMPTZ,
  response_required_by TIMESTAMPTZ,                  -- offered_at + 48h
  responded_at         TIMESTAMPTZ,
  expires_at           TIMESTAMPTZ NOT NULL,         -- created_at + 12d overall window
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (property_id, phone)
);

CREATE INDEX IF NOT EXISTS idx_wie_property_status_position
  ON waitlist_import_entries (property_id, status, position);
CREATE INDEX IF NOT EXISTS idx_wie_response_required_by
  ON waitlist_import_entries (response_required_by) WHERE status = 'offered';
CREATE INDEX IF NOT EXISTS idx_wie_expires_at
  ON waitlist_import_entries (expires_at) WHERE status IN ('queued','offered');
