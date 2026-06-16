/**
 * Tests for src/modules/cockpit-metrics/routes.ts — the NO-PII inbound metrics
 * endpoint for the token-watch Frank cockpit.
 *
 * Mount under test: GET /api/cockpit/inbound-metrics
 * Auth: shared-secret COCKPIT_METRICS_TOKEN (fail-closed 503 when unset).
 */

import express from "express";
import request from "supertest";
import type { QueryResult } from "pg";

jest.mock("../config/database", () => ({ query: jest.fn() }));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { query } from "../config/database";
import cockpitRouter from "../modules/cockpit-metrics/routes";

const mockQuery = query as jest.MockedFunction<typeof query>;

function qr<T extends Record<string, unknown>>(rows: T[]): QueryResult<T> {
  return { rows } as unknown as QueryResult<T>;
}

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use("/api/cockpit", cockpitRouter);
  return app;
}

const app = buildApp();

const ROW = {
  total_calls: 10,
  last_24h: 2,
  last_7d: 6,
  promoted: 4,
  callbacks_requested: 1,
  awaiting_review: 5,
  completed: 7,
  no_consent: 0,
};

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.COCKPIT_METRICS_TOKEN;
});

describe("GET /api/cockpit/inbound-metrics", () => {
  it("returns 503 (fail-closed) when COCKPIT_METRICS_TOKEN is unset", async () => {
    const res = await request(app).get("/api/cockpit/inbound-metrics");
    expect(res.status).toBe(503);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 401 with a wrong token", async () => {
    process.env.COCKPIT_METRICS_TOKEN = "secret";
    const res = await request(app)
      .get("/api/cockpit/inbound-metrics")
      .set("Authorization", "Bearer nope");
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 200 with no-PII counts on a correct bearer token", async () => {
    process.env.COCKPIT_METRICS_TOKEN = "secret";
    mockQuery.mockResolvedValueOnce(qr([ROW]));
    const res = await request(app)
      .get("/api/cockpit/inbound-metrics")
      .set("Authorization", "Bearer secret");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total_calls: 10, promoted: 4, completed: 7, awaiting_review: 5 });
    expect(res.body.answer_rate).toBeCloseTo(0.7);
    // contract: never leak PII fields
    expect(JSON.stringify(res.body)).not.toMatch(/name|phone|transcript|email|address/i);
  });

  it("accepts the x-cockpit-token header too", async () => {
    process.env.COCKPIT_METRICS_TOKEN = "secret";
    mockQuery.mockResolvedValueOnce(qr([ROW]));
    const res = await request(app)
      .get("/api/cockpit/inbound-metrics")
      .set("x-cockpit-token", "secret");
    expect(res.status).toBe(200);
    expect(res.body.total_calls).toBe(10);
  });

  it("returns answer_rate 0 when there are no calls", async () => {
    process.env.COCKPIT_METRICS_TOKEN = "secret";
    mockQuery.mockResolvedValueOnce(qr([{ total_calls: 0, completed: 0 }]));
    const res = await request(app)
      .get("/api/cockpit/inbound-metrics")
      .set("Authorization", "Bearer secret");
    expect(res.status).toBe(200);
    expect(res.body.answer_rate).toBe(0);
  });

  it("returns 500 on a database failure", async () => {
    process.env.COCKPIT_METRICS_TOKEN = "secret";
    mockQuery.mockRejectedValueOnce(new Error("db down"));
    const res = await request(app)
      .get("/api/cockpit/inbound-metrics")
      .set("Authorization", "Bearer secret");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Failed to load inbound metrics" });
  });
});
