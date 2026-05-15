/**
 * Unit-claim slice route tests for src/modules/applicants/routes.ts.
 *
 * Covers POST /applicants/intent, GET /applicants/units, POST
 * /applicants/claim-unit/:id, DELETE /applicants/claim-unit.
 *
 * Strategy: query() and transaction() are both mocked. transaction() invokes
 * its callback with a fake client whose .query() pulls from a per-test queue.
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

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/applicants", applicantsRouter);
  return app;
}
const app = buildApp();

/** Stub the users row that authenticate() reads from query(). */
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

/**
 * Wire transaction(fn) → fn(fakeClient) where fakeClient.query() pulls from
 * the supplied results queue, in order.
 */
function mockTxnWithQueue(rows: Array<{ rows: any[] }>) {
  const queue = [...rows];
  mockTransaction.mockImplementationOnce(async (fn: any) => {
    const client = {
      query: jest.fn().mockImplementation(() => {
        const next = queue.shift();
        if (!next) throw new Error("test queue exhausted");
        return Promise.resolve(next);
      }),
    };
    return fn(client);
  });
}

const applicant: AuthUser = {
  id: "applicant-001",
  email: "a@x.com",
  role: "applicant",
  firstName: "Ann",
  lastName: "App",
  propertyIds: [],
  emailVerified: true,
};

const VERIFIED_AT = new Date("2026-05-13T00:00:00Z");

describe("POST /applicants/intent", () => {
  beforeEach(() => jest.clearAllMocks());

  it("rejects unverified applicant with 403 EMAIL_UNVERIFIED", async () => {
    mockUsersRow(applicant, null);
    const token = generateToken(applicant, { emailVerified: false });
    const res = await request(app)
      .post("/applicants/intent")
      .set("Authorization", `Bearer ${token}`)
      .send({ bedrooms: 2, budget_max: 2000, move_in_date: "2026-07-01", household_size: 2 });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("EMAIL_UNVERIFIED");
  });

  it("validates body — 400 on bad bedrooms", async () => {
    mockUsersRow(applicant, VERIFIED_AT);
    const token = generateToken(applicant);
    const res = await request(app)
      .post("/applicants/intent")
      .set("Authorization", `Bearer ${token}`)
      .send({ bedrooms: 99, budget_max: 2000, move_in_date: "2026-07-01", household_size: 2 });
    expect(res.status).toBe(400);
  });

  it("UPSERTs intent on the existing draft application and returns its id", async () => {
    mockUsersRow(applicant, VERIFIED_AT);
    mockTxnWithQueue([
      { rows: [{ id: "app-existing-001" }] }, // SELECT draft
      { rows: [] },                            // UPDATE applications
    ]);
    const token = generateToken(applicant);
    const res = await request(app)
      .post("/applicants/intent")
      .set("Authorization", `Bearer ${token}`)
      .send({ bedrooms: 2, budget_max: 2000, move_in_date: "2026-07-01", household_size: 2 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, application_id: "app-existing-001" });
  });

  it("creates a draft application when none exists, picking a fallback property", async () => {
    mockUsersRow(applicant, VERIFIED_AT);
    mockTxnWithQueue([
      { rows: [] },                            // SELECT draft → none
      { rows: [{ id: "prop-fallback-001" }] }, // SELECT fallback property
      { rows: [{ id: "app-new-001" }] },       // INSERT applications
      { rows: [] },                            // INSERT user_applications
    ]);
    const token = generateToken(applicant);
    const res = await request(app)
      .post("/applicants/intent")
      .set("Authorization", `Bearer ${token}`)
      .send({ bedrooms: 1, budget_max: 1500, move_in_date: "2026-08-01", household_size: 1 });
    expect(res.status).toBe(200);
    expect(res.body.application_id).toBe("app-new-001");
  });

  it("503 NO_PROPERTIES when seed is empty and no draft exists", async () => {
    mockUsersRow(applicant, VERIFIED_AT);
    mockTxnWithQueue([
      { rows: [] }, // SELECT draft
      { rows: [] }, // SELECT fallback property → none
    ]);
    const token = generateToken(applicant);
    const res = await request(app)
      .post("/applicants/intent")
      .set("Authorization", `Bearer ${token}`)
      .send({ bedrooms: 1, budget_max: 1500, move_in_date: "2026-08-01", household_size: 1 });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("NO_PROPERTIES");
  });
});

describe("GET /applicants/units", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns up to 12 units matching filters", async () => {
    mockUsersRow(applicant, VERIFIED_AT);
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: "u1", unit_number: "A-101", monthly_rent: 1500, bedrooms: 2 },
        { id: "u2", unit_number: "A-102", monthly_rent: 1600, bedrooms: 2 },
      ],
    } as any);
    const token = generateToken(applicant);
    const res = await request(app)
      .get("/applicants/units?bedrooms=2&maxRent=1700")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.units).toHaveLength(2);

    const sql = mockQuery.mock.calls[1][0] as string;
    expect(sql).toContain("u.bedrooms = $1");
    expect(sql).toContain("u.monthly_rent <= $2");
    expect(sql).toMatch(/status = 'available'.*OR.*status = 'held'.*claim_expires_at < NOW\(\)/s);
    expect(sql).toContain("LIMIT 12");
  });

  it("ignores malformed propertyId (no SQL injection vector)", async () => {
    mockUsersRow(applicant, VERIFIED_AT);
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);
    const token = generateToken(applicant);
    const res = await request(app)
      .get("/applicants/units?propertyId=' OR '1'='1")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const sql = mockQuery.mock.calls[1][0] as string;
    const params = mockQuery.mock.calls[1][1] as unknown[] | undefined;
    // The malformed value never reaches the WHERE clause: no filter param,
    // and the WHERE has no property_id constraint.
    expect(sql).not.toMatch(/WHERE[\s\S]*u\.property_id =/);
    expect(params ?? []).toEqual([]);
  });

  it("rejects unverified user", async () => {
    mockUsersRow(applicant, null);
    const token = generateToken(applicant, { emailVerified: false });
    const res = await request(app)
      .get("/applicants/units")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

describe("POST /applicants/claim-unit/:id", () => {
  beforeEach(() => jest.clearAllMocks());

  const VALID_UNIT = "550e8400-e29b-41d4-a716-446655440000";
  const PROPERTY_ID = "550e8400-e29b-41d4-a716-446655440001";

  it("400 on malformed unit id", async () => {
    mockUsersRow(applicant, VERIFIED_AT);
    const token = generateToken(applicant);
    const res = await request(app)
      .post("/applicants/claim-unit/not-a-uuid")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it("200 when unit is available — sets held + 48h expiry on the user's draft", async () => {
    mockUsersRow(applicant, VERIFIED_AT);
    mockTxnWithQueue([
      { rows: [{ id: VALID_UNIT, property_id: PROPERTY_ID, status: "available", claim_expires_at: null }] },
      { rows: [{ id: "app-001", claimed_unit_id: null }] }, // SELECT draft
      { rows: [] },                                         // UPDATE units (held)
      { rows: [] },                                         // UPDATE applications
      {
        rows: [
          { id: VALID_UNIT, unit_number: "A-101", monthly_rent: 1500, property_name: "Sunny" },
        ],
      },
    ]);
    const before = Date.now();
    const token = generateToken(applicant);
    const res = await request(app)
      .post(`/applicants/claim-unit/${VALID_UNIT}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.unit.id).toBe(VALID_UNIT);
    expect(res.body.application_id).toBe("app-001");
    // expires_at is computed JS-side as now + 48h; verify it falls in that window.
    const expiry = new Date(res.body.expires_at).getTime();
    expect(expiry).toBeGreaterThanOrEqual(before + 48 * 3600 * 1000 - 1000);
    expect(expiry).toBeLessThanOrEqual(Date.now() + 48 * 3600 * 1000 + 1000);
  });

  it("409 UNIT_UNAVAILABLE when unit is held by another user (not stale)", async () => {
    mockUsersRow(applicant, VERIFIED_AT);
    const futureExpiry = new Date(Date.now() + 60_000).toISOString();
    mockTxnWithQueue([
      { rows: [{ id: VALID_UNIT, property_id: PROPERTY_ID, status: "held", claim_expires_at: futureExpiry }] },
    ]);
    const token = generateToken(applicant);
    const res = await request(app)
      .post(`/applicants/claim-unit/${VALID_UNIT}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("UNIT_UNAVAILABLE");
  });

  it("200 when unit is held but claim is stale — treats as available", async () => {
    mockUsersRow(applicant, VERIFIED_AT);
    const pastExpiry = new Date(Date.now() - 60_000).toISOString();
    mockTxnWithQueue([
      { rows: [{ id: VALID_UNIT, property_id: PROPERTY_ID, status: "held", claim_expires_at: pastExpiry }] },
      { rows: [{ id: "app-001", claimed_unit_id: null }] },
      { rows: [] },                                         // UPDATE units (held)
      { rows: [] },                                         // UPDATE applications
      { rows: [{ id: VALID_UNIT, unit_number: "A-101", property_name: "Sunny" }] },
    ]);
    const token = generateToken(applicant);
    const res = await request(app)
      .post(`/applicants/claim-unit/${VALID_UNIT}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("404 when unit doesn't exist", async () => {
    mockUsersRow(applicant, VERIFIED_AT);
    mockTxnWithQueue([{ rows: [] }]);
    const token = generateToken(applicant);
    const res = await request(app)
      .post(`/applicants/claim-unit/${VALID_UNIT}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("releases prior claim when switching units (atomic)", async () => {
    mockUsersRow(applicant, VERIFIED_AT);
    const PRIOR_UNIT = "550e8400-e29b-41d4-a716-446655440099";
    const calls: Array<[string, any[] | undefined]> = [];
    mockTransaction.mockImplementationOnce(async (fn: any) => {
      const queue: Array<{ rows: any[] }> = [
        { rows: [{ id: VALID_UNIT, property_id: PROPERTY_ID, status: "available", claim_expires_at: null }] },
        { rows: [{ id: "app-001", claimed_unit_id: PRIOR_UNIT }] },
        { rows: [] },                                       // UPDATE prior unit → available
        { rows: [] },                                       // UPDATE new unit → held
        { rows: [] },                                       // UPDATE applications
        { rows: [{ id: VALID_UNIT, unit_number: "A-101" }] },
      ];
      const client = {
        query: jest.fn().mockImplementation((sql: string, params?: any[]) => {
          calls.push([sql, params]);
          return Promise.resolve(queue.shift()!);
        }),
      };
      return fn(client);
    });
    const token = generateToken(applicant);
    const res = await request(app)
      .post(`/applicants/claim-unit/${VALID_UNIT}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);

    const releaseCall = calls.find(([sql]) => /UPDATE units\s+SET status = 'available'/.test(sql));
    expect(releaseCall).toBeDefined();
    expect(releaseCall![1]).toEqual([PRIOR_UNIT]);
  });

  it("creates a draft when claiming with none yet", async () => {
    mockUsersRow(applicant, VERIFIED_AT);
    mockTxnWithQueue([
      { rows: [{ id: VALID_UNIT, property_id: PROPERTY_ID, status: "available", claim_expires_at: null }] },
      { rows: [] }, // SELECT draft → none
      { rows: [{ id: "app-fresh-001" }] }, // INSERT application
      { rows: [] }, // INSERT user_applications
      { rows: [] }, // UPDATE units (held)
      { rows: [] }, // UPDATE applications
      { rows: [{ id: VALID_UNIT, unit_number: "A-101" }] },
    ]);
    const token = generateToken(applicant);
    const res = await request(app)
      .post(`/applicants/claim-unit/${VALID_UNIT}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.application_id).toBe("app-fresh-001");
  });
});

describe("DELETE /applicants/claim-unit", () => {
  beforeEach(() => jest.clearAllMocks());

  it("releases the user's current claim", async () => {
    mockUsersRow(applicant, VERIFIED_AT);
    const calls: Array<[string, any[] | undefined]> = [];
    mockTransaction.mockImplementationOnce(async (fn: any) => {
      const queue: Array<{ rows: any[] }> = [
        { rows: [{ id: "app-001", claimed_unit_id: "unit-XYZ" }] }, // SELECT draft
        { rows: [] }, // UPDATE units → available
        { rows: [] }, // UPDATE applications → null
      ];
      const client = {
        query: jest.fn().mockImplementation((sql: string, params?: any[]) => {
          calls.push([sql, params]);
          return Promise.resolve(queue.shift()!);
        }),
      };
      return fn(client);
    });
    const token = generateToken(applicant);
    const res = await request(app)
      .delete("/applicants/claim-unit")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const unitUpdate = calls.find(([sql]) => /UPDATE units\s+SET status = 'available'/.test(sql));
    expect(unitUpdate![1]).toEqual(["unit-XYZ"]);
  });

  it("ok=true even when user has no active claim (idempotent)", async () => {
    mockUsersRow(applicant, VERIFIED_AT);
    mockTxnWithQueue([
      { rows: [] }, // SELECT draft → none with claim
    ]);
    const token = generateToken(applicant);
    const res = await request(app)
      .delete("/applicants/claim-unit")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
