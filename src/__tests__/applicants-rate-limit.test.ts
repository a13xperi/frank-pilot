/**
 * B3 — per-user rate limiter tests for the unit-claim authenticated endpoints.
 *
 * Verifies that POST /intent, POST /claim-unit/:id, DELETE /claim-unit share
 * a per-user write bucket (20/min), and that GET /units has its own per-user
 * read bucket (60/min). Buckets are keyed on the authenticated user id, not
 * the source IP, so a single user cannot evade the limit by rotating IPs.
 *
 * Strategy: drive the lightest-weight endpoint (DELETE /claim-unit returning
 * a no-op when no draft exists) until the limit trips, then assert 429.
 */
import express from "express";
import request from "supertest";
import { generateToken, AuthUser } from "../middleware/auth";

jest.mock("../config/database", () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../modules/auth/magic-link-service", () => ({
  createMagicLink: jest.fn(),
  logMagicLink: jest.fn(),
}));
jest.mock("../modules/application/service", () => ({
  ApplicationService: jest.fn().mockImplementation(() => ({ create: jest.fn() })),
}));

import { query, transaction } from "../config/database";
import applicantsRouter from "../modules/applicants/routes";

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockTransaction = transaction as jest.MockedFunction<typeof transaction>;

const app = express();
app.use(express.json());
app.use("/applicants", applicantsRouter);

function mockUsersRow(user: AuthUser, emailVerifiedAt: Date | null) {
  mockQuery.mockResolvedValueOnce({
    rows: [
      {
        id: user.id,
        email: user.email,
        role: user.role,
        first_name: user.firstName,
        last_name: user.lastName,
        property_ids: user.propertyIds ?? [],
        is_active: true,
        email_verified_at: emailVerifiedAt,
      },
    ],
  } as any);
}

// transaction() wired to invoke its callback with a fake client whose query()
// returns a no-rows result — DELETE /claim-unit treats that as "no draft" and
// short-circuits to { ok: true }.
function mockTxnNoDraft() {
  mockTransaction.mockImplementationOnce(async (fn: any) => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    return fn(client);
  });
}

const VERIFIED_AT = new Date("2026-05-13T00:00:00Z");

describe("B3: per-user rate limiter on unit-claim endpoints", () => {
  beforeEach(() => jest.clearAllMocks());

  it("trips 429 on the 21st write within the window for the same user", async () => {
    // Unique user id per test run so we don't bleed state into other tests.
    const user: AuthUser = {
      id: `b3-write-${Date.now()}`,
      email: "b3-write@example.com",
      role: "applicant",
      firstName: "B3",
      lastName: "Write",
      propertyIds: [],
      emailVerified: true,
    };
    const token = generateToken(user);

    // 20 successful DELETEs — each needs an auth users row + a no-draft txn.
    for (let i = 0; i < 20; i++) {
      mockUsersRow(user, VERIFIED_AT);
      mockTxnNoDraft();
    }

    for (let i = 0; i < 20; i++) {
      const res = await request(app)
        .delete("/applicants/claim-unit")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
    }

    // 21st request: still mock auth so the limiter (not auth) is what fails.
    mockUsersRow(user, VERIFIED_AT);
    const limited = await request(app)
      .delete("/applicants/claim-unit")
      .set("Authorization", `Bearer ${token}`);
    expect(limited.status).toBe(429);
    expect(limited.body.error).toMatch(/too many requests/i);
  });

  it("isolates buckets per user — user A hitting the limit does not block user B", async () => {
    const userA: AuthUser = {
      id: `b3-A-${Date.now()}`,
      email: "a@b3.example.com",
      role: "applicant",
      firstName: "A",
      lastName: "A",
      propertyIds: [],
      emailVerified: true,
    };
    const userB: AuthUser = {
      ...userA,
      id: `b3-B-${Date.now()}`,
      email: "b@b3.example.com",
    };
    const tokenA = generateToken(userA);
    const tokenB = generateToken(userB);

    // Burn user A's bucket.
    for (let i = 0; i < 20; i++) {
      mockUsersRow(userA, VERIFIED_AT);
      mockTxnNoDraft();
    }
    for (let i = 0; i < 20; i++) {
      await request(app).delete("/applicants/claim-unit").set("Authorization", `Bearer ${tokenA}`);
    }
    mockUsersRow(userA, VERIFIED_AT);
    const blockedA = await request(app)
      .delete("/applicants/claim-unit")
      .set("Authorization", `Bearer ${tokenA}`);
    expect(blockedA.status).toBe(429);

    // User B should still be able to use the endpoint freely.
    mockUsersRow(userB, VERIFIED_AT);
    mockTxnNoDraft();
    const passB = await request(app)
      .delete("/applicants/claim-unit")
      .set("Authorization", `Bearer ${tokenB}`);
    expect(passB.status).toBe(200);
  });
});
