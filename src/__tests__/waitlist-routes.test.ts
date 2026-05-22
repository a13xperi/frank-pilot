/**
 * Wedge #5 — Position-aware waitlist route tests.
 *
 * Covers:
 *   GET    /applicants/properties/:slug/waitlist-summary
 *   POST   /applicants/properties/:slug/waitlist-join
 *   DELETE /applicants/properties/:slug/waitlist-leave
 *
 * Strategy mirrors src/__tests__/unit-claim.test.ts: query() is mocked and
 * each test scripts the rows the handler will SELECT/INSERT/DELETE.
 *
 * Note on query ordering: `authenticate` issues a SELECT against users before
 * the handler runs, so authenticated tests must mockUsersRow() first.
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
  sendMagicLink: jest.fn(),
}));
jest.mock("../modules/application/service", () => ({
  ApplicationService: jest.fn().mockImplementation(() => ({ create: jest.fn() })),
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

// Per-test unique user id so the per-user rate limiter on POST/DELETE
// (20/min, shared across the write bucket) doesn't bleed between tests.
let __testSeq = 0;
function makeApplicant(): AuthUser {
  __testSeq += 1;
  return {
    id: `waitlist-test-${Date.now()}-${__testSeq}`,
    email: `wl${__testSeq}@x.com`,
    role: "applicant",
    firstName: "Ann",
    lastName: "App",
    propertyIds: [],
    emailVerified: true,
  };
}

const VERIFIED_AT = new Date("2026-05-13T00:00:00Z");
const SLUG = "donna-louise-2";
const PROPERTY_ID = "550e8400-e29b-41d4-a716-446655440099";

describe("GET /applicants/properties/:slug/waitlist-summary", () => {
  beforeEach(() => jest.clearAllMocks());

  it("400 when ?bedrooms is missing", async () => {
    const res = await request(app).get(`/applicants/properties/${SLUG}/waitlist-summary`);
    expect(res.status).toBe(400);
  });

  it("404 when slug resolves to no property", async () => {
    // resolvePropertyIdBySlug → no match
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);
    const res = await request(app)
      .get(`/applicants/properties/${SLUG}/waitlist-summary?bedrooms=2`);
    expect(res.status).toBe(404);
  });

  it("unauth: returns totalQueue with no position (enrolled=false)", async () => {
    // Query order without auth: resolve slug → total queue.
    mockQuery.mockResolvedValueOnce({ rows: [{ id: PROPERTY_ID }] } as any); // resolve slug
    mockQuery.mockResolvedValueOnce({ rows: [{ n: 7 }] } as any);            // total queue

    const res = await request(app)
      .get(`/applicants/properties/${SLUG}/waitlist-summary?bedrooms=2`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      slug: SLUG,
      totalQueue: 7,
      enrolled: false,
      movement: null,
    });
    expect(res.body.position).toBeUndefined();
    expect(typeof res.body.estimatedWindow).toBe("string");
  });

  it("auth + enrolled: returns position computed from rows ahead + 1", async () => {
    // Query order with auth: resolve slug → user lookup (optional auth) →
    // total queue → SELECT mine → COUNT ahead.
    const applicant = makeApplicant();
    mockQuery.mockResolvedValueOnce({ rows: [{ id: PROPERTY_ID }] } as any); // resolve slug
    mockQuery.mockResolvedValueOnce({ rows: [{ id: applicant.id }] } as any); // user lookup
    mockQuery.mockResolvedValueOnce({ rows: [{ n: 3 }] } as any);            // total queue
    mockQuery.mockResolvedValueOnce({                                          // SELECT mine
      rows: [
        {
          created_at: new Date("2026-05-20T12:00:00Z"),
          notified_position_at: null,
          last_notified_position: null,
        },
      ],
    } as any);
    mockQuery.mockResolvedValueOnce({ rows: [{ n: 1 }] } as any);            // COUNT ahead

    const token = generateToken(applicant);
    const res = await request(app)
      .get(`/applicants/properties/${SLUG}/waitlist-summary?bedrooms=2`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      slug: SLUG,
      position: 2,           // 1 ahead + 1
      totalQueue: 3,
      enrolled: true,
      movement: null,        // null when no notification snapshot exists
    });
  });

  it("auth + enrolled + prior snapshot: returns movement direction=up", async () => {
    const applicant = makeApplicant();
    mockQuery.mockResolvedValueOnce({ rows: [{ id: PROPERTY_ID }] } as any);  // resolve slug
    mockQuery.mockResolvedValueOnce({ rows: [{ id: applicant.id }] } as any); // user lookup
    mockQuery.mockResolvedValueOnce({ rows: [{ n: 10 }] } as any);            // total
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          created_at: new Date("2026-05-20T12:00:00Z"),
          notified_position_at: new Date("2026-04-20T12:00:00Z"),
          last_notified_position: 8,
        },
      ],
    } as any);
    mockQuery.mockResolvedValueOnce({ rows: [{ n: 4 }] } as any); // 4 ahead → position 5

    const token = generateToken(applicant);
    const res = await request(app)
      .get(`/applicants/properties/${SLUG}/waitlist-summary?bedrooms=2`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.position).toBe(5);
    expect(res.body.movement).toEqual({ spotsThisMonth: 3, direction: "up" });
  });

  it("auth but not enrolled: enrolled=false, no position", async () => {
    const applicant = makeApplicant();
    mockQuery.mockResolvedValueOnce({ rows: [{ id: PROPERTY_ID }] } as any);  // resolve slug
    mockQuery.mockResolvedValueOnce({ rows: [{ id: applicant.id }] } as any); // user lookup
    mockQuery.mockResolvedValueOnce({ rows: [{ n: 5 }] } as any);             // total queue
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);                      // SELECT mine → none

    const token = generateToken(applicant);
    const res = await request(app)
      .get(`/applicants/properties/${SLUG}/waitlist-summary?bedrooms=2`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      enrolled: false,
      totalQueue: 5,
      movement: null,
    });
    expect(res.body.position).toBeUndefined();
  });

  it("estimatedWindow shifts with queue depth", async () => {
    // unauth path → resolve slug + total queue only.
    mockQuery.mockResolvedValueOnce({ rows: [{ id: PROPERTY_ID }] } as any); // resolve
    mockQuery.mockResolvedValueOnce({ rows: [{ n: 50 }] } as any);

    const res = await request(app)
      .get(`/applicants/properties/${SLUG}/waitlist-summary?bedrooms=2`);
    expect(res.status).toBe(200);
    expect(res.body.estimatedWindow).toBe("6+ months");
  });
});

describe("POST /applicants/properties/:slug/waitlist-join", () => {
  beforeEach(() => jest.clearAllMocks());

  it("401 unauthenticated", async () => {
    const res = await request(app)
      .post(`/applicants/properties/${SLUG}/waitlist-join`)
      .send({ bedrooms: 2 });
    expect(res.status).toBe(401);
  });

  it("400 on bad body (bedrooms missing)", async () => {
    const applicant = makeApplicant();
    mockUsersRow(applicant, VERIFIED_AT);
    const token = generateToken(applicant);
    const res = await request(app)
      .post(`/applicants/properties/${SLUG}/waitlist-join`)
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it("404 when slug resolves to nothing", async () => {
    const applicant = makeApplicant();
    mockUsersRow(applicant, VERIFIED_AT);
    mockQuery.mockResolvedValueOnce({ rows: [] } as any); // resolve slug → none
    const token = generateToken(applicant);
    const res = await request(app)
      .post(`/applicants/properties/${SLUG}/waitlist-join`)
      .set("Authorization", `Bearer ${token}`)
      .send({ bedrooms: 2 });
    expect(res.status).toBe(404);
  });

  it("first-to-join gets position 1, totalQueue 1", async () => {
    const applicant = makeApplicant();
    mockUsersRow(applicant, VERIFIED_AT);
    mockQuery.mockResolvedValueOnce({ rows: [{ id: PROPERTY_ID }] } as any); // resolve slug
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);                     // INSERT
    // buildWaitlistSummary follow-up:
    mockQuery.mockResolvedValueOnce({ rows: [{ n: 1 }] } as any);             // total
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          created_at: new Date("2026-05-23T00:00:00Z"),
          notified_position_at: null,
          last_notified_position: null,
        },
      ],
    } as any);
    mockQuery.mockResolvedValueOnce({ rows: [{ n: 0 }] } as any);             // 0 ahead

    const token = generateToken(applicant);
    const res = await request(app)
      .post(`/applicants/properties/${SLUG}/waitlist-join`)
      .set("Authorization", `Bearer ${token}`)
      .send({ bedrooms: 2 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      position: 1,
      totalQueue: 1,
      enrolled: true,
    });
  });

  it("re-join is idempotent (ON CONFLICT DO NOTHING) — same position returned", async () => {
    const applicant = makeApplicant();
    mockUsersRow(applicant, VERIFIED_AT);
    mockQuery.mockResolvedValueOnce({ rows: [{ id: PROPERTY_ID }] } as any);
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);                     // INSERT (no rows = conflict)
    mockQuery.mockResolvedValueOnce({ rows: [{ n: 3 }] } as any);             // total = same as before
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          created_at: new Date("2026-05-21T00:00:00Z"),
          notified_position_at: null,
          last_notified_position: null,
        },
      ],
    } as any);
    mockQuery.mockResolvedValueOnce({ rows: [{ n: 1 }] } as any);             // still 1 ahead

    const token = generateToken(applicant);
    const res = await request(app)
      .post(`/applicants/properties/${SLUG}/waitlist-join`)
      .set("Authorization", `Bearer ${token}`)
      .send({ bedrooms: 2 });
    expect(res.status).toBe(201);
    expect(res.body.position).toBe(2);
    expect(res.body.totalQueue).toBe(3);

    // The INSERT must use ON CONFLICT DO NOTHING.
    const insertSql = mockQuery.mock.calls.find(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("INSERT INTO waitlist_entries")
    )?.[0] as string;
    expect(insertSql).toContain("ON CONFLICT");
    expect(insertSql).toContain("DO NOTHING");
  });
});

describe("DELETE /applicants/properties/:slug/waitlist-leave", () => {
  beforeEach(() => jest.clearAllMocks());

  it("401 unauthenticated", async () => {
    const res = await request(app)
      .delete(`/applicants/properties/${SLUG}/waitlist-leave?bedrooms=2`);
    expect(res.status).toBe(401);
  });

  it("400 when bedrooms missing", async () => {
    const applicant = makeApplicant();
    mockUsersRow(applicant, VERIFIED_AT);
    const token = generateToken(applicant);
    const res = await request(app)
      .delete(`/applicants/properties/${SLUG}/waitlist-leave`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it("idempotent: ok=true even when no row to delete", async () => {
    const applicant = makeApplicant();
    mockUsersRow(applicant, VERIFIED_AT);
    mockQuery.mockResolvedValueOnce({ rows: [{ id: PROPERTY_ID }] } as any); // resolve slug
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);        // DELETE → 0
    const token = generateToken(applicant);
    const res = await request(app)
      .delete(`/applicants/properties/${SLUG}/waitlist-leave?bedrooms=2`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("issues a DELETE keyed on (property, bedrooms, user)", async () => {
    const applicant = makeApplicant();
    mockUsersRow(applicant, VERIFIED_AT);
    mockQuery.mockResolvedValueOnce({ rows: [{ id: PROPERTY_ID }] } as any);
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as any);
    const token = generateToken(applicant);
    const res = await request(app)
      .delete(`/applicants/properties/${SLUG}/waitlist-leave?bedrooms=2`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const deleteCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("DELETE FROM waitlist_entries")
    );
    expect(deleteCall).toBeDefined();
    expect(deleteCall![1]).toEqual([PROPERTY_ID, 2, applicant.id]);
  });
});
