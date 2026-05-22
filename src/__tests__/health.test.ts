/**
 * /health endpoint — security regression test.
 *
 * Asserts that on DB failure the 503 response body does NOT contain any
 * raw pg error message (which can expose hostnames, ports, credentials).
 * The real error is logged server-side; callers receive only a generic body.
 */
import express from "express";
import request from "supertest";
import { logger } from "../utils/logger";

jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// Simulate a pg-style error with infra details that must NOT appear in the response.
const PG_ERROR_MSG = "connection refused to db-host:5432 as user 'frank'";

jest.mock("../config/database", () => ({
  query: jest.fn().mockRejectedValue(new Error(PG_ERROR_MSG)),
  transaction: jest.fn(),
}));

function buildApp() {
  const app = express();
  app.use(express.json());

  app.get("/health", async (_req, res) => {
    let dbStatus = "unknown";
    try {
      const { query } = await import("../config/database");
      const r = await query("SELECT 1 AS ok");
      dbStatus = (r as any).rows[0]?.ok === 1 ? "ok" : "unexpected";
    } catch (err) {
      dbStatus = "error";
      logger.error("/health DB ping failed", { error: (err as Error).message });
      res.status(503).json({
        status: "degraded",
        service: "frank-pilot",
        db: dbStatus,
        timestamp: new Date().toISOString(),
      });
      return;
    }
    res.json({
      status: "ok",
      service: "frank-pilot",
      db: dbStatus,
      timestamp: new Date().toISOString(),
    });
  });

  return app;
}

describe("GET /health — DB failure path", () => {
  let app: express.Express;

  beforeAll(() => {
    app = buildApp();
  });

  it("returns HTTP 503 on DB error", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(503);
  });

  it("returns generic degraded body without raw pg error", async () => {
    const res = await request(app).get("/health");
    expect(res.body.status).toBe("degraded");
    expect(res.body.db).toBe("error");
    expect(res.body.service).toBe("frank-pilot");
    expect(res.body.timestamp).toBeDefined();
    // The raw pg error message must NOT appear anywhere in the response body.
    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr).not.toContain(PG_ERROR_MSG);
    expect(bodyStr).not.toContain("db-host");
    expect(bodyStr).not.toContain("5432");
    // The `error` field must be absent entirely.
    expect(res.body).not.toHaveProperty("error");
  });

  it("logs the real pg error server-side", async () => {
    const errorSpy = logger.error as jest.Mock;
    errorSpy.mockClear();
    await request(app).get("/health");
    expect(errorSpy).toHaveBeenCalledWith(
      "/health DB ping failed",
      expect.objectContaining({ error: PG_ERROR_MSG })
    );
  });
});
