-- Voice browser sessions ("Talk to Frank" — S1)
--
-- One row per minted ElevenLabs signed-URL session. This table is the single
-- source of truth for THREE guardrails on the in-browser voice channel:
--
--   1) Per-IP rate limit  (3 sessions / rolling hour)
--   2) Per-cookie rate    (5 sessions / rolling hour)
--   3) Daily budget cap   (sum(est_cost_usd) over rolling 24h < $5 default)
--
-- Pre-charge model: we don't know the actual conversation duration at mint
-- time, so each row books `max_duration_secs/60 * cost_per_min_usd` against
-- the budget up front. The post-call webhook backfills actual_cost_usd +
-- duration_secs when the conversation closes. Over-budgeting is intentional
-- and SAFE — it caps spend at the worst-case ceiling and the real bill is
-- always strictly lower.
--
-- PII discipline (CLAUDE.md "Don't exfiltrate private data" + AGENTS.md
-- "No PII on public URLs"): raw IPs MUST NEVER be stored. ip_hash is
-- sha256(raw_ip + VOICE_BROWSER_IP_HASH_SECRET) so the rate-limit lookup
-- stays correlatable per-deployment but is non-reversible.
--
-- conversation_id is nullable because ElevenLabs' get-signed-url response
-- doesn't include it; the SDK reports it on the client once the WebRTC
-- handshake completes. The post-call webhook will later UPDATE this row
-- (matched on agent_id + nearest created_at within window) to bind the
-- session row to the actual conversation_id.

BEGIN;

CREATE TABLE IF NOT EXISTS voice_browser_sessions (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- ElevenLabs side. agent_id is NOT NULL because every session pins to one
  -- agent at mint time; conversation_id is NULL until the SDK reports it.
  agent_id            TEXT NOT NULL,
  conversation_id     TEXT,

  -- Identity surface. user_id is nullable — anonymous visitors are the
  -- common case for "Talk to Frank" (mirrors the outbound phone semantics).
  -- ip_hash + cookie_id are the rate-limit keys; both stay populated even
  -- when user_id is set so an abusive logged-in user is still capped.
  ip_hash             TEXT NOT NULL,
  cookie_id           TEXT,
  user_id             UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Budget accounting (pre-charge at mint, actual backfilled post-call).
  est_cost_usd        NUMERIC(10,4) NOT NULL,
  actual_cost_usd     NUMERIC(10,4),
  duration_secs       INTEGER,
  max_duration_secs   INTEGER NOT NULL,

  -- Deny path: when this row is the AUDIT entry for a denied request, NULLs
  -- on est_cost_usd would break the budget sum so we still write a zero
  -- est_cost row and flag it.
  outcome             VARCHAR(16) NOT NULL DEFAULT 'minted',
  deny_reason         VARCHAR(32),

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Rolling-window lookups dominate this table. Three composite indexes power
-- the three guardrail SELECTs; all three lead with the rate-limit/budget
-- key + created_at DESC for the WHERE created_at > NOW() - INTERVAL '...'
-- pattern the handler uses.

CREATE INDEX IF NOT EXISTS idx_voice_browser_sessions_ip_window
  ON voice_browser_sessions(ip_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_voice_browser_sessions_cookie_window
  ON voice_browser_sessions(cookie_id, created_at DESC)
  WHERE cookie_id IS NOT NULL;

-- Budget cap query: SUM(est_cost_usd) WHERE created_at > NOW() - 1 day AND
-- outcome = 'minted'. Partial index keeps the scan tight even at high deny
-- rates.
CREATE INDEX IF NOT EXISTS idx_voice_browser_sessions_budget
  ON voice_browser_sessions(created_at DESC)
  WHERE outcome = 'minted';

-- Post-call backfill: webhook matches conversation_id once known.
CREATE INDEX IF NOT EXISTS idx_voice_browser_sessions_conversation
  ON voice_browser_sessions(conversation_id)
  WHERE conversation_id IS NOT NULL;

COMMIT;
