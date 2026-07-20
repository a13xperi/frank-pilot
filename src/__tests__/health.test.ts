/**
 * /health endpoint tests — run against the REAL handler
 * (src/modules/health/route.ts), which index.ts mounts. This file previously
 * asserted a hand-copied replica of the route, which silently drifted when
 * backlog #12 (#405) extended the handler; the extraction closes that gap.
 *
 * Contract under test:
 *   - only a DB-ping failure flips the HTTP code to 503 (Railway's deploy
 *     healthcheck keys off the code);
 *   - Sage/ElevenLabs reachability + dialer staleness degrade the BODY status
 *     only ("degraded" @ HTTP 200 — alerting reads the body);
 *   - "not_configured"/"unknown" reachability is NOT degraded;
 *   - extended-check failures are swallowed (observability must never break
 *     the endpoint it rides on);
 *   - a DB failure body never leaks the raw pg error (hostnames, ports,
 *     credentials) — the security regression this file originally guarded.
 */
import express from "express";
import request from "supertest";
import { logger } from "../utils/logger";

jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockQuery = jest.fn();
jest.mock("../config/database", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  transaction: jest.fn(),
}));

const mockReachability = jest.fn();
const mockDialerStatus = jest.fn();
jest.mock("../utils/health-checks", () => ({
  externalReachability: (...args: unknown[]) => mockReachability(...args),
  dialerTickStatus: (...args: unknown[]) => mockDialerStatus(...args),
}));

import { healthHandler } from "../modules/health/route";

function buildApp() {
  const app = express();
  app.get("/health", healthHandler);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockResolvedValue({ rows: [{ ok: 1 }] });
  mockReachability.mockResolvedValue({ sage: "ok", elevenlabs: "ok" });
  mockDialerStatus.mockResolvedValue({ state: "ticking", healthy: true });
});

describe("GET /health", () => {
  it("200 ok with db + reachability + dialer fields when everything is healthy", async () => {
    const res = await request(buildApp()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "ok",
      service: "frank-pilot",
      db: "ok",
      sage: "ok",
      elevenlabs: "ok",
      dialer: { state: "ticking", healthy: true },
    });
    expect(res.body.timestamp).toBeDefined();
  });

  it("degrades the BODY (not the HTTP code) when the dialer is stale", async () => {
    mockDialerStatus.mockResolvedValue({ state: "stale", healthy: false });
    const res = await request(buildApp()).get("/health");
    expect(res.status).toBe(200); // a stale dialer must not fail the deploy healthcheck
    expect(res.body.status).toBe("degraded");
    expect(res.body.dialer).toMatchObject({ state: "stale", healthy: false });
  });

  it("degrades on bad vendor reachability (http_401 / unreachable), still HTTP 200", async () => {
    mockReachability.mockResolvedValue({ sage: "http_401", elevenlabs: "ok" });
    const sageBad = await request(buildApp()).get("/health");
    expect(sageBad.status).toBe(200);
    expect(sageBad.body.status).toBe("degraded");

    mockReachability.mockResolvedValue({ sage: "ok", elevenlabs: "unreachable" });
    const elBad = await request(buildApp()).get("/health");
    expect(elBad.status).toBe(200);
    expect(elBad.body.status).toBe("degraded");
  });

  it("treats not_configured/unknown reachability as fine (dark vendors are not outages)", async () => {
    mockReachability.mockResolvedValue({ sage: "not_configured", elevenlabs: "unknown" });
    const res = await request(buildApp()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("swallows an extended-check failure: 200 ok with unknown fields, logged as a warning", async () => {
    mockReachability.mockRejectedValue(new Error("probe melt"));
    const res = await request(buildApp()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.sage).toBe("unknown");
    expect(res.body.elevenlabs).toBe("unknown");
    expect(logger.warn).toHaveBeenCalledWith(
      "/health extended checks failed",
      expect.objectContaining({ error: "probe melt" })
    );
  });

  it("reports db 'unexpected' on a malformed ping row without flipping the HTTP code", async () => {
    mockQuery.mockResolvedValue({ rows: [{ ok: 2 }] });
    const res = await request(buildApp()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.db).toBe("unexpected");
  });

  it("503 degraded on DB failure, without leaking the raw pg error to callers", async () => {
    const PG_ERROR_MSG = "connection refused to db-host:5432 as user 'frank'";
    mockQuery.mockRejectedValue(new Error(PG_ERROR_MSG));

    const res = await request(buildApp()).get("/health");
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: "degraded", service: "frank-pilot", db: "error" });

    // The infra details must be logged server-side, never sent to the caller.
    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr).not.toContain(PG_ERROR_MSG);
    expect(bodyStr).not.toContain("db-host");
    expect(bodyStr).not.toContain("5432");
    expect(res.body).not.toHaveProperty("error");
    expect(logger.error).toHaveBeenCalledWith(
      "/health DB ping failed",
      expect.objectContaining({ error: PG_ERROR_MSG })
    );
  });
});
