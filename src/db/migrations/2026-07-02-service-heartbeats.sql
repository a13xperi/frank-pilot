-- Backlog #12: background-job liveness. One row per named job, upserted on
-- every successful tick; /health reads freshness so a silently-dead dialer
-- surfaces in minutes instead of at the 8pm Notion report (≤8h blind spot).
CREATE TABLE IF NOT EXISTS service_heartbeats (
  name    TEXT PRIMARY KEY,
  beat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  detail  JSONB
);
