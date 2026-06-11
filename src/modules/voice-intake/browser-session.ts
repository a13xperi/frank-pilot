import { Router, Request, Response } from "express";
import crypto from "crypto";
import { query } from "../../config/database";
import { logger } from "../../utils/logger";
import { stampTape } from "../tape";

/**
 * "Talk to Frank" — in-browser WebRTC session minter (S1).
 *
 * POST /api/voice/sessions proxies ElevenLabs' `get-signed-url` API so the
 * agent_id + API key never reach the browser. Every well-formed request
 * runs the three guardrails defined in
 * migrations/2026-05-31-voice-browser-sessions.sql:
 *
 *   1) Per-IP rate limit  — 3 mints / rolling hour, ip_hash window
 *   2) Per-cookie rate    — 5 mints / rolling hour, cookie window
 *   3) Daily budget cap   — SUM(est_cost_usd) over rolling 24h vs $5 default
 *
 * Pre-charge model: we book worst-case cost
 * (max_duration_secs / 60 * cost_per_min_usd) against the budget at mint
 * time. The post-call webhook will later UPDATE the row with the actual
 * cost. Over-budgeting is intentional — caps spend at the worst-case
 * ceiling and the real bill is always strictly lower.
 *
 * PII discipline (CLAUDE.md "Don't exfiltrate private data"): raw IPs are
 * hashed with VOICE_BROWSER_IP_HASH_SECRET before they ever hit the DB.
 * Rotating that secret forgets all rate-limit history.
 *
 * Failure mode policy:
 *   - 503 — flag off, sentinel secret, no API key, daily budget exhausted
 *   - 429 — per-IP or per-cookie rate limit
 *   - 502 — ElevenLabs upstream error (NOT pre-charged; deny row + reason)
 *   - 200 — { signedUrl, agentId, sessionId, maxDurationSecs }
 *
 * The cookie this route mints (`frank_voice_session_id`) is opaque, HttpOnly,
 * SameSite=Lax, ~1yr TTL. It exists ONLY as a rate-limit key; no PII rides
 * in it, no auth, no session state.
 */

const COOKIE_NAME = "frank_voice_session_id";
const COOKIE_MAX_AGE_SECS = 60 * 60 * 24 * 365; // ~1 year

const RATE_LIMIT_PER_IP_PER_HOUR = 3;
const RATE_LIMIT_PER_COOKIE_PER_HOUR = 5;

const DEFAULT_DAILY_CAP_USD = 5.0;
const DEFAULT_MAX_DURATION_SECS = 600;
const DEFAULT_COST_PER_MIN_USD = 0.07;

const ELEVENLABS_API_BASE = "https://api.elevenlabs.io";

type DenyReason =
  | "rate_limited_ip"
  | "rate_limited_cookie"
  | "budget_exhausted"
  | "upstream_error";

function readCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

function getNumericEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function hashIp(ip: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(ip).digest("hex");
}

function resolveClientIp(req: Request): string {
  // `trust proxy = 1` is set in src/index.ts so req.ip already resolves the
  // first X-Forwarded-For hop. Fall back to a stable sentinel if it ever
  // comes back undefined so the hash still produces a value (and that whole
  // class gets rate-limited as one bucket — defense, not punishment).
  return req.ip || "unknown";
}

async function countInWindow(
  whereClause: string,
  params: unknown[],
  windowInterval: string
): Promise<number> {
  const result = await query(
    `SELECT COUNT(*)::int AS count
       FROM voice_browser_sessions
      WHERE ${whereClause}
        AND created_at > NOW() - INTERVAL '${windowInterval}'`,
    params
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function sumDailyEstCost(): Promise<number> {
  const result = await query(
    `SELECT COALESCE(SUM(est_cost_usd), 0)::numeric AS total
       FROM voice_browser_sessions
      WHERE outcome = 'minted'
        AND created_at > NOW() - INTERVAL '1 day'`,
    []
  );
  return Number(result.rows[0]?.total ?? 0);
}

async function insertMintedRow(args: {
  agentId: string;
  conversationId: string | null;
  ipHash: string;
  cookieId: string;
  userId: string | null;
  estCostUsd: number;
  maxDurationSecs: number;
}): Promise<string> {
  const result = await query(
    `INSERT INTO voice_browser_sessions
       (agent_id, conversation_id, ip_hash, cookie_id, user_id,
        est_cost_usd, max_duration_secs, outcome)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'minted')
     RETURNING id`,
    [
      args.agentId,
      args.conversationId,
      args.ipHash,
      args.cookieId,
      args.userId,
      args.estCostUsd,
      args.maxDurationSecs,
    ]
  );
  return String(result.rows[0].id);
}

async function insertDeniedRow(args: {
  agentId: string;
  ipHash: string;
  cookieId: string;
  userId: string | null;
  reason: DenyReason;
  maxDurationSecs: number;
}): Promise<void> {
  await query(
    `INSERT INTO voice_browser_sessions
       (agent_id, ip_hash, cookie_id, user_id, est_cost_usd,
        max_duration_secs, outcome, deny_reason)
     VALUES ($1, $2, $3, $4, 0, $5, 'denied', $6)`,
    [
      args.agentId,
      args.ipHash,
      args.cookieId,
      args.userId,
      args.maxDurationSecs,
      args.reason,
    ]
  );
}

async function fetchSignedUrl(
  agentId: string,
  apiKey: string
): Promise<{ ok: true; signedUrl: string } | { ok: false; status: number; body: string }> {
  const url = `${ELEVENLABS_API_BASE}/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(
    agentId
  )}`;
  let resp: globalThis.Response;
  try {
    resp = await fetch(url, {
      method: "GET",
      headers: { "xi-api-key": apiKey, accept: "application/json" },
    });
  } catch (err) {
    return { ok: false, status: 0, body: (err as Error).message };
  }

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    return { ok: false, status: resp.status, body };
  }

  const json = (await resp.json().catch(() => null)) as { signed_url?: string } | null;
  if (!json?.signed_url) {
    return { ok: false, status: 502, body: "missing signed_url in response" };
  }
  return { ok: true, signedUrl: json.signed_url };
}

// Indirection point so the jest spec can stub the upstream without spinning
// up a mock fetch globally. Production code path stays a vanilla call.
let _signedUrlFetcher = fetchSignedUrl;
export function __setSignedUrlFetcherForTests(
  fn: typeof fetchSignedUrl | null
): void {
  _signedUrlFetcher = fn ?? fetchSignedUrl;
}

interface SessionContext {
  agentId: string;
  apiKey: string;
  ipHashSecret: string;
  dailyCapUsd: number;
  maxDurationSecs: number;
  costPerMinUsd: number;
}

function loadContext(): SessionContext | { error: string; status: number } {
  const agentId = process.env.ELEVENLABS_AGENT_ID;
  if (!agentId) {
    return { error: "agent not configured", status: 503 };
  }
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return { error: "api key not configured", status: 503 };
  }
  const ipHashSecret = process.env.VOICE_BROWSER_IP_HASH_SECRET;
  if (!ipHashSecret || ipHashSecret.startsWith("changeme")) {
    // Fail closed on misconfig — refusing to write unhashed-equivalent rows
    // (a fixed secret across deploys would still hash but lose the rotation
    // property that makes this PII-safe).
    return { error: "ip hash secret not configured", status: 503 };
  }
  return {
    agentId,
    apiKey,
    ipHashSecret,
    dailyCapUsd: getNumericEnv("VOICE_BROWSER_DAILY_CAP_USD", DEFAULT_DAILY_CAP_USD),
    maxDurationSecs: getNumericEnv(
      "VOICE_BROWSER_MAX_DURATION_SECS",
      DEFAULT_MAX_DURATION_SECS
    ),
    costPerMinUsd: getNumericEnv(
      "VOICE_BROWSER_COST_PER_MIN_USD",
      DEFAULT_COST_PER_MIN_USD
    ),
  };
}

const router = Router();

router.post("/", async (req: Request, res: Response): Promise<void> => {
  if (process.env.VOICE_BROWSER_SESSIONS_ENABLED !== "true") {
    res.status(503).json({ error: "voice_disabled" });
    return;
  }

  // TENANT-SCOPE ATTESTATION (Jun 11): the agent's prompt/grounding lives in
  // ElevenLabs dashboard config, outside this repo — the chat path's scope fix
  // (housing-qa tenant scope) cannot bound it. The rehearsal leak (statewide
  // HUD-LIHTC answers, internal names) applies to this surface until the
  // remote agent is re-grounded and re-verified, so the pipeline fails closed:
  // no mint unless an operator explicitly attests, via this flag, that the
  // agent resolved by ELEVENLABS_AGENT_ID passed the tenant-scope checklist
  // (FAQ-corpus grounding only, declines property searches, no internal
  // names). Same opaque body as the master flag — callers learn nothing.
  if (process.env.VOICE_AGENT_TENANT_SCOPED !== "true") {
    logger.warn(
      "voice-browser-session: mint refused — agent not attested tenant-scoped",
      { agentId: process.env.ELEVENLABS_AGENT_ID ?? null }
    );
    res.status(503).json({ error: "voice_disabled" });
    return;
  }

  const ctxOrErr = loadContext();
  if ("error" in ctxOrErr) {
    res.status(ctxOrErr.status).json({ error: ctxOrErr.error });
    return;
  }
  const ctx = ctxOrErr;

  const rawIp = resolveClientIp(req);
  const ipHash = hashIp(rawIp, ctx.ipHashSecret);

  let cookieId = readCookie(req.headers.cookie, COOKIE_NAME);
  const cookieIsFresh = !cookieId;
  if (!cookieId) {
    cookieId = crypto.randomUUID();
  }

  // userId stays optional — anon visitors are the dominant case. We pull
  // from res.locals.user (set by upstream auth middleware) when authed.
  const userId =
    (res.locals?.user as { id?: string } | undefined)?.id ?? null;

  const estCostUsd = Number(
    ((ctx.maxDurationSecs / 60) * ctx.costPerMinUsd).toFixed(4)
  );

  const deny = async (
    reason: DenyReason,
    status: number,
    body: Record<string, unknown>
  ): Promise<void> => {
    try {
      await insertDeniedRow({
        agentId: ctx.agentId,
        ipHash,
        cookieId: cookieId!,
        userId,
        reason,
        maxDurationSecs: ctx.maxDurationSecs,
      });
    } catch (err) {
      logger.error("voice-browser-session: deny row insert failed", {
        reason,
        error: (err as Error).message,
      });
    }
    void stampTape({
      kind: "VOICE_BROWSER_SESSION_DENIED",
      actor: "voice-browser-session",
      payload: { reason, agentId: ctx.agentId, userId },
    });
    if (cookieIsFresh) setSessionCookie(res, cookieId!);
    res.status(status).json(body);
  };

  // 1) Per-IP rate limit
  const ipCount = await countInWindow("ip_hash = $1", [ipHash], "1 hour");
  if (ipCount >= RATE_LIMIT_PER_IP_PER_HOUR) {
    await deny("rate_limited_ip", 429, {
      error: "rate_limited",
      scope: "ip",
      retryAfterSecs: 60 * 60,
    });
    return;
  }

  // 2) Per-cookie rate limit (only meaningful when a returning cookie is
  // present — a fresh cookie can't have prior rows).
  if (!cookieIsFresh) {
    const cookieCount = await countInWindow("cookie_id = $1", [cookieId], "1 hour");
    if (cookieCount >= RATE_LIMIT_PER_COOKIE_PER_HOUR) {
      await deny("rate_limited_cookie", 429, {
        error: "rate_limited",
        scope: "cookie",
        retryAfterSecs: 60 * 60,
      });
      return;
    }
  }

  // 3) Daily budget cap. Check BEFORE the upstream API call so a budget-trip
  // never racks up an ElevenLabs charge for a session we won't return.
  const dailySpend = await sumDailyEstCost();
  if (dailySpend + estCostUsd > ctx.dailyCapUsd) {
    await deny("budget_exhausted", 503, {
      error: "budget_exhausted",
      retryAfterSecs: 60 * 60,
    });
    return;
  }

  // 4) Mint the signed URL upstream.
  const upstream = await _signedUrlFetcher(ctx.agentId, ctx.apiKey);
  if (!upstream.ok) {
    logger.error("voice-browser-session: upstream get-signed-url failed", {
      status: upstream.status,
      body: upstream.body,
    });
    await deny("upstream_error", 502, { error: "upstream_error" });
    return;
  }

  // 5) Pre-charge: insert a 'minted' row BEFORE returning the signed URL so
  // a concurrent burst of requests can't all see the same dailySpend and
  // each get past the budget gate. (The check above is best-effort; the row
  // is the durable proof.)
  let sessionId: string;
  try {
    sessionId = await insertMintedRow({
      agentId: ctx.agentId,
      conversationId: null,
      ipHash,
      cookieId,
      userId,
      estCostUsd,
      maxDurationSecs: ctx.maxDurationSecs,
    });
  } catch (err) {
    logger.error("voice-browser-session: minted row insert failed", {
      error: (err as Error).message,
    });
    res.status(500).json({ error: "internal_error" });
    return;
  }

  void stampTape({
    kind: "VOICE_BROWSER_SESSION_STARTED",
    actor: "voice-browser-session",
    sessionId,
    payload: {
      sessionId,
      agentId: ctx.agentId,
      userId,
      estCostUsd,
      maxDurationSecs: ctx.maxDurationSecs,
    },
  });

  setSessionCookie(res, cookieId);
  res.status(200).json({
    signedUrl: upstream.signedUrl,
    agentId: ctx.agentId,
    sessionId,
    maxDurationSecs: ctx.maxDurationSecs,
  });
});

function setSessionCookie(res: Response, cookieId: string): void {
  // Manual Set-Cookie keeps us off the cookie-parser dep the rest of the
  // app avoids (see auth/routes.ts readCookie). SameSite=Lax + HttpOnly is
  // appropriate for a rate-limit token: not readable from JS, doesn't leak
  // cross-site, but still sent on first-party navigations.
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${encodeURIComponent(cookieId)}; ` +
      `Max-Age=${COOKIE_MAX_AGE_SECS}; Path=/; HttpOnly; SameSite=Lax${secure}`
  );
}

export default router;

export const __test = {
  hashIp,
  readCookie,
  COOKIE_NAME,
  RATE_LIMIT_PER_IP_PER_HOUR,
  RATE_LIMIT_PER_COOKIE_PER_HOUR,
};
