-- Position-aware waitlist (gpmglv-gap wedge #5) — 2026-05-23
-- One row per (property, bedroom_count, user). Position is derived from
-- created_at ordering at query time. `notified_position_at` /
-- `last_notified_position` snapshot what we last told the applicant so the
-- API can compute monthly "moved up N spots" movement without storing a
-- per-day position history.

CREATE TABLE IF NOT EXISTS waitlist_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  bedroom_count SMALLINT NOT NULL,
  applicant_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notified_position_at TIMESTAMPTZ,
  last_notified_position SMALLINT,
  UNIQUE (property_id, bedroom_count, applicant_user_id)
);

-- Hot query path: rank by created_at within a (property, bedroom_count) lane.
CREATE INDEX IF NOT EXISTS idx_waitlist_entries_lane_created
  ON waitlist_entries(property_id, bedroom_count, created_at);
CREATE INDEX IF NOT EXISTS idx_waitlist_entries_user
  ON waitlist_entries(applicant_user_id);
