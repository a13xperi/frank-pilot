/**
 * Tests for POST /api/screening/batch — the fee-decoupled lease-up pilot tool.
 * Service-secret gated, fail-closed, dryRun by default. We mock the DB layer and
 * the ScreeningService so we assert wiring + auth without touching real vendors.
 */
import express from "express";
import request from "supertest";

jest.mock("../config/database", () => ({ query: jest.fn(), transaction: jest.fn() }));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
// The router imports these at module load; stub so import has no side effects.
jest.mock("../middleware/auth", () => ({
  authenticate: (_req: any, _res: any, next: any) => next(),
}));
jest.mock("../middleware/rbac", () => ({
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
}));

const mockRunFullScreening = jest.fn();
jest.mock("../modules/screening/service", () => ({
  ScreeningService: jest.fn().mockImplementation(() => ({ runFullScreening: mockRunFullScreening })),
}));
jest.mock("../modules/screening/fraud-detection", () => ({
  FraudDetectionService: jest.fn().mockImplementation(() => ({})),
}));

import { query } from "../config/database";
import screeningRouter from "../modules/screening/routes";

const mockQuery = query as jest.MockedFunction<typeof query>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/screening", screeningRouter);
  return app;
}
const app = buildApp();

const SECRET = "test-screen-secret-1234567890";

beforeEach(() => {
  jest.clearAllMocks();
  process.env.SCREEN_BATCH_ENABLED = "true";
  process.env.SCREEN_BATCH_SECRET = SECRET;
});
afterAll(() => {
  delete process.env.SCREEN_BATCH_ENABLED;
  delete process.env.SCREEN_BATCH_SECRET;
});

describe("POST /api/screening/batch", () => {
  it("503 (fail-closed) when SCREEN_BATCH_ENABLED is not 'true'", async () => {
    process.env.SCREEN_BATCH_ENABLED = "false";
    const res = await request(app).post("/api/screening/batch").set("x-frank-screen-secret", SECRET).send({});
    expect(res.status).toBe(503);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("401 when the secret is wrong or missing", async () => {
    const bad = await request(app).post("/api/screening/batch").set("x-frank-screen-secret", "nope").send({});
    expect(bad.status).toBe(401);
    const none = await request(app).post("/api/screening/batch").send({});
    expect(none.status).toBe(401);
    expect(mockRunFullScreening).not.toHaveBeenCalled();
  });

  it("dryRun (default) lists eligible submitted apps and screens nothing", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: "app-1", submitted_by: "u1", submitter_role: "applicant" },
        { id: "app-2", submitted_by: "u2", submitter_role: "applicant" },
      ],
    } as any);
    const res = await request(app).post("/api/screening/batch").set("x-frank-screen-secret", SECRET).send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, dryRun: true, eligible: 2, ids: ["app-1", "app-2"] });
    expect(mockRunFullScreening).not.toHaveBeenCalled();
    // The query must scope to submitted apps with a real submitter.
    expect(String(mockQuery.mock.calls[0][0])).toMatch(/status = 'submitted'/);
    expect(String(mockQuery.mock.calls[0][0])).toMatch(/submitted_by IS NOT NULL/);
  });

  it("dryRun:false screens each submitted app and summarizes by verdict", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: "app-1", submitted_by: "u1", submitter_role: "applicant" },
        { id: "app-2", submitted_by: "u2", submitter_role: null },
      ],
    } as any);
    mockRunFullScreening
      .mockResolvedValueOnce({ overallResult: "pass" })
      .mockResolvedValueOnce({ overallResult: "review_required" });

    const res = await request(app)
      .post("/api/screening/batch")
      .set("x-frank-screen-secret", SECRET)
      .send({ dryRun: false });

    expect(res.status).toBe(200);
    expect(mockRunFullScreening).toHaveBeenCalledTimes(2);
    expect(mockRunFullScreening).toHaveBeenCalledWith("app-1", "u1", "applicant");
    // null submitter_role falls back to "applicant".
    expect(mockRunFullScreening).toHaveBeenCalledWith("app-2", "u2", "applicant");
    expect(res.body.summary).toEqual({ pass: 1, review_required: 1 });
    expect(res.body.screened).toHaveLength(2);
  });

  it("captures a per-app screening error without failing the whole batch", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: "app-1", submitted_by: "u1", submitter_role: "applicant" },
        { id: "app-2", submitted_by: "u2", submitter_role: "applicant" },
      ],
    } as any);
    mockRunFullScreening
      .mockResolvedValueOnce({ overallResult: "pass" })
      .mockRejectedValueOnce(new Error("vendor timeout"));

    const res = await request(app)
      .post("/api/screening/batch")
      .set("x-frank-screen-secret", SECRET)
      .send({ dryRun: false });

    expect(res.status).toBe(200);
    expect(res.body.screened).toHaveLength(1);
    expect(res.body.errors).toEqual([{ id: "app-2", error: "vendor timeout" }]);
  });
});
