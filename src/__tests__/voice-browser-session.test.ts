/**
 * Tests for src/modules/voice-intake/browser-session.ts — the "Talk to Frank"
 * in-browser WebRTC session minter mounted at POST /api/voice/sessions.
 *
 * The router enforces three guardrails in strict order:
 *   1) Per-IP rate limit  — 3 sessions / rolling hour
 *   2) Per-cookie rate    — 5 / hour (skipped on a fresh cookie)
 *   3) Daily budget cap   — SUM(est_cost_usd) over 24h < VOICE_BROWSER_DAILY_CAP_USD
 *
 * Specs below assert each gate independently, then the happy-path mint, then
 * the upstream-error branch. Mock SQL responses are ordered to mirror the
 * exact call sequence in browser-session.ts:
 *   countInWindow(ip)            → number
 *   countInWindow(cookie)        → number   (only when cookie present)
 *   sumDailyEstCost              → number
 *   insertMintedRow              → { id: <uuid> }
 *   insertDeniedRow              → void     (on the deny branches)
 *
 * Status-code policy (see browser-session.ts header):
 *   - 503 when flag off, config missing, OR daily budget exhausted
 *   - 429 on per-IP or per-cookie rate limit
 *   - 502 on ElevenLabs upstream error
 *   - 200 on mint
 */

import express from "express";
import request from "supertest";

const AGENT_ID = "agent_8001ksp9ar8cf8ct2x70kacxr8qq";
const API_KEY = "xi_test_fixture_key";
const IP_HASH_SECRET = "test-ip-hash-secret-do-not-use-in-prod";

const mockQuery = jest.fn();
jest.mock("../config/database", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockStampTape = jest.fn().mockResolvedValue(null);
jest.mock("../modules/tape", () => {
  const real = jest.requireActual("../modules/tape");
  return { ...real, stampTape: mockStampTape };
});

import browserSessionRouter, {
  __setSignedUrlFetcherForTests,
} from "../modules/voice-intake/browser-session";

function buildApp(): express.Express {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use("/api/voice/sessions", browserSessionRouter);
  return app;
}

function mockUpstreamSuccess(signedUrl = "wss://api.elevenlabs.io/test-signed-url"): void {
  __setSignedUrlFetcherForTests(async () => ({ ok: true, signedUrl }));
}

function mockUpstreamFailure(status = 500, body = "boom"): void {
  __setSignedUrlFetcherForTests(async () => ({ ok: false, status, body }));
}

beforeEach(() => {
  jest.clearAllMocks();
  __setSignedUrlFetcherForTests(null);
  process.env.VOICE_BROWSER_SESSIONS_ENABLED = "true";
  // Tenant-scope attestation (Jun 11) — required alongside the master flag.
  process.env.VOICE_AGENT_TENANT_SCOPED = "true";
  process.env.ELEVENLABS_AGENT_ID = AGENT_ID;
  process.env.ELEVENLABS_API_KEY = API_KEY;
  process.env.VOICE_BROWSER_IP_HASH_SECRET = IP_HASH_SECRET;
  process.env.VOICE_BROWSER_DAILY_CAP_USD = "5.00";
  process.env.VOICE_BROWSER_MAX_DURATION_SECS = "600";
  process.env.VOICE_BROWSER_COST_PER_MIN_USD = "0.07";
});

afterAll(() => {
  __setSignedUrlFetcherForTests(null);
  delete process.env.VOICE_BROWSER_SESSIONS_ENABLED;
  delete process.env.VOICE_AGENT_TENANT_SCOPED;
  delete process.env.ELEVENLABS_AGENT_ID;
  delete process.env.ELEVENLABS_API_KEY;
  delete process.env.VOICE_BROWSER_IP_HASH_SECRET;
  delete process.env.VOICE_BROWSER_DAILY_CAP_USD;
  delete process.env.VOICE_BROWSER_MAX_DURATION_SECS;
  delete process.env.VOICE_BROWSER_COST_PER_MIN_USD;
});

describe("voice browser session — config gates", () => {
  it("returns 503 when VOICE_BROWSER_SESSIONS_ENABLED is off", async () => {
    process.env.VOICE_BROWSER_SESSIONS_ENABLED = "false";
    const res = await request(buildApp()).post("/api/voice/sessions").send({});
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: "voice_disabled" });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 503 when the agent is not attested tenant-scoped — even with sessions enabled", async () => {
    delete process.env.VOICE_AGENT_TENANT_SCOPED;
    const res = await request(buildApp()).post("/api/voice/sessions").send({});
    expect(res.status).toBe(503);
    // Same opaque body as the master flag — the caller can't distinguish.
    expect(res.body).toEqual({ error: "voice_disabled" });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("attestation fails closed on any value other than the literal 'true'", async () => {
    process.env.VOICE_AGENT_TENANT_SCOPED = "1";
    const res = await request(buildApp()).post("/api/voice/sessions").send({});
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: "voice_disabled" });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 503 when agent id is unset", async () => {
    delete process.env.ELEVENLABS_AGENT_ID;
    const res = await request(buildApp()).post("/api/voice/sessions").send({});
    expect(res.status).toBe(503);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 503 when api key is unset", async () => {
    delete process.env.ELEVENLABS_API_KEY;
    const res = await request(buildApp()).post("/api/voice/sessions").send({});
    expect(res.status).toBe(503);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 503 when ip-hash secret is the sentinel — fail closed on misconfig", async () => {
    process.env.VOICE_BROWSER_IP_HASH_SECRET = "changeme-rotate-to-forget-rate-limit-history";
    const res = await request(buildApp()).post("/api/voice/sessions").send({});
    expect(res.status).toBe(503);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe("voice browser session — rate limits", () => {
  it("denies with 429 when per-IP count is at the 3/hr limit", async () => {
    mockUpstreamSuccess();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: 3 }] }) // ip count
      .mockResolvedValueOnce({ rows: [] }); // insertDeniedRow

    const res = await request(buildApp())
      .post("/api/voice/sessions")
      .send({});

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ error: "rate_limited", scope: "ip" });

    // Deny row written so future analysis can see the 429.
    const denyInsert = mockQuery.mock.calls.find((c) =>
      String(c[0]).includes("INSERT INTO voice_browser_sessions") &&
      String(c[0]).includes("'denied'")
    );
    expect(denyInsert).toBeDefined();
    expect(denyInsert![1][5]).toBe("rate_limited_ip");

    expect(mockStampTape).toHaveBeenCalledTimes(1);
    expect(mockStampTape.mock.calls[0][0]).toMatchObject({
      kind: "VOICE_BROWSER_SESSION_DENIED",
      payload: expect.objectContaining({ reason: "rate_limited_ip" }),
    });
  });

  it("denies with 429 on per-cookie limit when cookie is returning and at 5/hr", async () => {
    mockUpstreamSuccess();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: 0 }] }) // ip count
      .mockResolvedValueOnce({ rows: [{ count: 5 }] }) // cookie count
      .mockResolvedValueOnce({ rows: [] }); // insertDeniedRow

    const res = await request(buildApp())
      .post("/api/voice/sessions")
      .set("Cookie", "frank_voice_session_id=existing-cookie-uuid")
      .send({});

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ error: "rate_limited", scope: "cookie" });

    const denyInsert = mockQuery.mock.calls.find((c) =>
      String(c[0]).includes("INSERT INTO voice_browser_sessions") &&
      String(c[0]).includes("'denied'")
    );
    expect(denyInsert).toBeDefined();
    expect(denyInsert![1][5]).toBe("rate_limited_cookie");
  });

  it("skips the per-cookie SELECT when no cookie is presented", async () => {
    mockUpstreamSuccess();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: 0 }] }) // ip count
      .mockResolvedValueOnce({ rows: [{ total: 0 }] }) // sumDailyEstCost
      .mockResolvedValueOnce({ rows: [{ id: "session-uuid-1" }] }); // insertMintedRow

    const res = await request(buildApp())
      .post("/api/voice/sessions")
      .send({});

    expect(res.status).toBe(200);

    // Inspect the query log: there must be no cookie_id = $1 lookup.
    const cookieLookup = mockQuery.mock.calls.find((c) =>
      String(c[0]).includes("WHERE cookie_id = $1")
    );
    expect(cookieLookup).toBeUndefined();
  });
});

describe("voice browser session — budget cap", () => {
  it("denies with 503 budget_exhausted when daily spend + est_cost > cap", async () => {
    mockUpstreamSuccess();
    // est_cost = (600/60) * 0.07 = $0.70 worst case. With $4.50 spent +
    // $0.70 incoming = $5.20 > $5 cap → deny.
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: 0 }] }) // ip
      .mockResolvedValueOnce({ rows: [{ total: 4.5 }] }) // sumDailyEstCost
      .mockResolvedValueOnce({ rows: [] }); // insertDeniedRow

    const res = await request(buildApp())
      .post("/api/voice/sessions")
      .send({});

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: "budget_exhausted" });

    const denyInsert = mockQuery.mock.calls.find((c) =>
      String(c[0]).includes("INSERT INTO voice_browser_sessions") &&
      String(c[0]).includes("'denied'")
    );
    expect(denyInsert).toBeDefined();
    expect(denyInsert![1][5]).toBe("budget_exhausted");

    expect(mockStampTape).toHaveBeenCalledTimes(1);
    expect(mockStampTape.mock.calls[0][0]).toMatchObject({
      kind: "VOICE_BROWSER_SESSION_DENIED",
      payload: expect.objectContaining({ reason: "budget_exhausted" }),
    });
  });

  it("mints when daily spend + est_cost still fits under the cap", async () => {
    mockUpstreamSuccess();
    // $4.20 spent + $0.70 = $4.90 — fits under $5.
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: 0 }] }) // ip
      .mockResolvedValueOnce({ rows: [{ total: 4.2 }] }) // sumDailyEstCost
      .mockResolvedValueOnce({ rows: [{ id: "session-uuid-2" }] }); // mint

    const res = await request(buildApp())
      .post("/api/voice/sessions")
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBe("session-uuid-2");
  });
});

describe("voice browser session — happy path", () => {
  it("mints a signed URL, inserts a row, stamps tape, sets a cookie", async () => {
    mockUpstreamSuccess("wss://api.elevenlabs.io/the-signed-url-xyz");
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: 0 }] }) // ip
      .mockResolvedValueOnce({ rows: [{ total: 0 }] }) // budget
      .mockResolvedValueOnce({ rows: [{ id: "session-uuid-happy" }] }); // mint

    const res = await request(buildApp())
      .post("/api/voice/sessions")
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      signedUrl: "wss://api.elevenlabs.io/the-signed-url-xyz",
      agentId: AGENT_ID,
      sessionId: "session-uuid-happy",
      maxDurationSecs: 600,
    });

    // Set-Cookie present, HttpOnly + SameSite=Lax.
    const cookies = res.headers["set-cookie"];
    const cookieList = Array.isArray(cookies) ? cookies : cookies ? [cookies] : [];
    expect(cookieList.length).toBe(1);
    expect(cookieList[0]).toMatch(/frank_voice_session_id=/);
    expect(cookieList[0]).toMatch(/HttpOnly/);
    expect(cookieList[0]).toMatch(/SameSite=Lax/);

    // Minted row carries the pre-charged est_cost = 600/60 * 0.07 = 0.70.
    const mintInsert = mockQuery.mock.calls.find((c) =>
      String(c[0]).includes("INSERT INTO voice_browser_sessions") &&
      String(c[0]).includes("'minted'")
    );
    expect(mintInsert).toBeDefined();
    const params = mintInsert![1] as unknown[];
    expect(params[0]).toBe(AGENT_ID); // agent_id
    expect(params[1]).toBeNull(); // conversation_id (not known yet)
    expect(typeof params[2]).toBe("string"); // ip_hash
    expect((params[2] as string).length).toBe(64); // sha256 hex
    expect(params[5]).toBe(0.7); // est_cost_usd
    expect(params[6]).toBe(600); // max_duration_secs

    expect(mockStampTape).toHaveBeenCalledTimes(1);
    expect(mockStampTape.mock.calls[0][0]).toMatchObject({
      kind: "VOICE_BROWSER_SESSION_STARTED",
      sessionId: "session-uuid-happy",
      payload: expect.objectContaining({
        agentId: AGENT_ID,
        estCostUsd: 0.7,
        maxDurationSecs: 600,
      }),
    });
  });

  it("reuses a returning cookie value when one is presented", async () => {
    mockUpstreamSuccess();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: 0 }] }) // ip
      .mockResolvedValueOnce({ rows: [{ count: 0 }] }) // cookie
      .mockResolvedValueOnce({ rows: [{ total: 0 }] }) // budget
      .mockResolvedValueOnce({ rows: [{ id: "session-uuid-cookie" }] }); // mint

    const incomingCookie = "returning-cookie-abc-123";
    const res = await request(buildApp())
      .post("/api/voice/sessions")
      .set("Cookie", `frank_voice_session_id=${incomingCookie}`)
      .send({});

    expect(res.status).toBe(200);
    const mintInsert = mockQuery.mock.calls.find((c) =>
      String(c[0]).includes("INSERT INTO voice_browser_sessions") &&
      String(c[0]).includes("'minted'")
    );
    const params = mintInsert![1] as unknown[];
    expect(params[3]).toBe(incomingCookie); // cookie_id matches what arrived
  });
});

describe("voice browser session — upstream failure", () => {
  it("returns 502 + deny row when ElevenLabs get-signed-url fails", async () => {
    mockUpstreamFailure(500, "elevenlabs is sad");
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: 0 }] }) // ip
      .mockResolvedValueOnce({ rows: [{ total: 0 }] }) // budget
      .mockResolvedValueOnce({ rows: [] }); // insertDeniedRow

    const res = await request(buildApp())
      .post("/api/voice/sessions")
      .send({});

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: "upstream_error" });

    const denyInsert = mockQuery.mock.calls.find((c) =>
      String(c[0]).includes("INSERT INTO voice_browser_sessions") &&
      String(c[0]).includes("'denied'")
    );
    expect(denyInsert).toBeDefined();
    expect(denyInsert![1][5]).toBe("upstream_error");

    expect(mockStampTape).toHaveBeenCalledTimes(1);
    expect(mockStampTape.mock.calls[0][0]).toMatchObject({
      kind: "VOICE_BROWSER_SESSION_DENIED",
      payload: expect.objectContaining({ reason: "upstream_error" }),
    });
  });
});
