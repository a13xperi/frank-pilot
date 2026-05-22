/**
 * INFO-1 (W6 re-audit) — /register wall-clock floor.
 *
 * The three /register branches do different amounts of DB work:
 *   - staff           = 2 SELECT, 0 INSERT
 *   - existing app    = 2 SELECT, 1 INSERT
 *   - new applicant   = 2 SELECT, 2 INSERT
 *
 * The handler floors the response wall-clock at REGISTER_RESPONSE_FLOOR_MS
 * (or NODE_ENV-default 250ms in non-test envs) so the three buckets aren't
 * distinguishable downstream. These tests confirm the floor activates
 * without locking the exact default value (which is environment-dependent).
 */
import express from "express";
import request from "supertest";

jest.mock("../config/database", () => ({ query: jest.fn(), transaction: jest.fn() }));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockCreateMagicLink = jest.fn();
const mockLogMagicLink = jest.fn();
const mockSendMagicLink = jest.fn();
jest.mock("../modules/auth/magic-link-service", () => ({
  createMagicLink: mockCreateMagicLink,
  logMagicLink: mockLogMagicLink,
  sendMagicLink: mockSendMagicLink,
}));

import { query } from "../config/database";
import applicantsRouter from "../modules/applicants/routes";

const mockQuery = query as jest.MockedFunction<typeof query>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/applicants", applicantsRouter);
  return app;
}
const app = buildApp();

describe("POST /applicants/register — INFO-1 timing floor", () => {
  const ORIGINAL_FLOOR = process.env.REGISTER_RESPONSE_FLOOR_MS;
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => {
    if (ORIGINAL_FLOOR === undefined) delete process.env.REGISTER_RESPONSE_FLOOR_MS;
    else process.env.REGISTER_RESPONSE_FLOOR_MS = ORIGINAL_FLOOR;
  });

  it("floors response wall-clock at REGISTER_RESPONSE_FLOOR_MS for the fast (staff) path", async () => {
    process.env.REGISTER_RESPONSE_FLOOR_MS = "150";
    // Staff branch: SELECT users returns a staff role; createMagicLink
    // short-circuits to null. Zero INSERTs — the otherwise-fastest path.
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: "staff-1", role: "leasing_agent", is_active: true }],
    } as any);
    mockCreateMagicLink.mockResolvedValueOnce(null);

    const t0 = Date.now();
    const res = await request(app)
      .post("/applicants/register")
      .send({ email: "staff@example.com", firstName: "S", lastName: "T" });
    const elapsed = Date.now() - t0;

    expect(res.status).toBe(202);
    // Allow ~25ms negative fudge for timer granularity / event-loop scheduling.
    expect(elapsed).toBeGreaterThanOrEqual(125);
  });

  it("does not stall meaningfully beyond the floor when the path is already slow", async () => {
    process.env.REGISTER_RESPONSE_FLOOR_MS = "50";
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "n-1" }] } as any);
    mockCreateMagicLink.mockResolvedValueOnce({ link: "http://x/auth/callback?token=raw", userId: "n-1" });

    const t0 = Date.now();
    const res = await request(app)
      .post("/applicants/register")
      .send({ email: "new@example.com", firstName: "N", lastName: "U" });
    const elapsed = Date.now() - t0;

    expect(res.status).toBe(202);
    // Floor is small; the request should not add multi-second overhead.
    expect(elapsed).toBeLessThan(2000);
  });

  it("floor=0 keeps fast paths fast", async () => {
    process.env.REGISTER_RESPONSE_FLOOR_MS = "0";
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: "staff-1", role: "leasing_agent", is_active: true }],
    } as any);
    mockCreateMagicLink.mockResolvedValueOnce(null);

    const t0 = Date.now();
    const res = await request(app)
      .post("/applicants/register")
      .send({ email: "staff@example.com", firstName: "S", lastName: "T" });
    const elapsed = Date.now() - t0;

    expect(res.status).toBe(202);
    expect(elapsed).toBeLessThan(150);
  });
});
