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
  sendMagicLink: jest.fn(),
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

  // Regression for bug_010 (issue #19): the "4+ BR" filter sends bedrooms=4
  // and previously matched u.bedrooms = $1 — meaning a 5BR or 6BR unit would
  // silently fail the filter. New contract: callers send bedroomsMin for
  // inclusive semantics, and it wins if both are sent.
  it("uses inclusive >= when bedroomsMin is provided", async () => {
    mockUsersRow(applicant, VERIFIED_AT);
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);
    const token = generateToken(applicant);
    const res = await request(app)
      .get("/applicants/units?bedroomsMin=4")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const sql = mockQuery.mock.calls[1][0] as string;
    const params = mockQuery.mock.calls[1][1] as unknown[];
    expect(sql).toContain("u.bedrooms >= $1");
    expect(sql).not.toMatch(/u\.bedrooms = \$/);
    expect(params).toEqual([4]);
  });

  it("bedroomsMin wins over bedrooms when both are sent", async () => {
    mockUsersRow(applicant, VERIFIED_AT);
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);
    const token = generateToken(applicant);
    const res = await request(app)
      .get("/applicants/units?bedrooms=2&bedroomsMin=4")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const sql = mockQuery.mock.calls[1][0] as string;
    const params = mockQuery.mock.calls[1][1] as unknown[];
    expect(sql).toContain("u.bedrooms >= $1");
    expect(sql).not.toMatch(/u\.bedrooms = \$/);
    expect(params).toEqual([4]);
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

  it("scopes to a valid UUID propertyId without a slug lookup", async () => {
    mockUsersRow(applicant, VERIFIED_AT);
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);
    const token = generateToken(applicant);
    const uuid = "550e8400-e29b-41d4-a716-446655440001";
    const res = await request(app)
      .get(`/applicants/units?propertyId=${uuid}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    // A UUID is used directly — no extra slug lookup: just auth row + picker.
    expect(mockQuery).toHaveBeenCalledTimes(2);
    const sql = mockQuery.mock.calls[1][0] as string;
    const params = mockQuery.mock.calls[1][1] as unknown[];
    expect(sql).toMatch(/u\.property_id = \$\d+/);
    expect(params).toContain(uuid);
  });

  // The client + QR links carry the legacy MVP slug (?propertyId=donna-louise-2),
  // but the backend derives slugs from the property NAME ("Donna Louise
  // Apartments 2" → donna-louise-apartments-2). The resolver must map the alias
  // to the name-derived slug, then scope to the RESOLVED id.
  it("resolves the legacy donna-louise-2 alias to the name slug, then to its UUID", async () => {
    mockUsersRow(applicant, VERIFIED_AT);
    const uuid = "550e8400-e29b-41d4-a716-446655440001";
    mockQuery.mockResolvedValueOnce({ rows: [{ id: uuid }] } as any); // slug → id
    mockQuery.mockResolvedValueOnce({ rows: [] } as any); // picker
    const token = generateToken(applicant);
    const res = await request(app)
      .get("/applicants/units?propertyId=donna-louise-2")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    // auth row + slug lookup + picker.
    expect(mockQuery).toHaveBeenCalledTimes(3);
    const slugSql = mockQuery.mock.calls[1][0] as string;
    expect(slugSql).toContain("FROM properties");
    // The alias is mapped to the current name-derived slug before the lookup.
    expect(mockQuery.mock.calls[1][1]).toEqual(["donna-louise-apartments-2"]);
    // The picker scopes to the resolved UUID, never the raw slug.
    const sql = mockQuery.mock.calls[2][0] as string;
    const params = mockQuery.mock.calls[2][1] as unknown[];
    expect(sql).toMatch(/u\.property_id = \$\d+/);
    expect(params).toContain(uuid);
    expect(params).not.toContain("donna-louise-2");
  });

  // A non-aliased slug passes through to the name-derivation lookup unchanged.
  it("passes a non-aliased slug through unchanged", async () => {
    mockUsersRow(applicant, VERIFIED_AT);
    const uuid = "550e8400-e29b-41d4-a716-446655440002";
    mockQuery.mockResolvedValueOnce({ rows: [{ id: uuid }] } as any); // slug → id
    mockQuery.mockResolvedValueOnce({ rows: [] } as any); // picker
    const token = generateToken(applicant);
    const res = await request(app)
      .get("/applicants/units?propertyId=louise-shell-senior-apartments")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[1][1]).toEqual(["louise-shell-senior-apartments"]);
  });

  it("rejects unverified user", async () => {
    mockUsersRow(applicant, null);
    const token = generateToken(applicant, { emailVerified: false });
    const res = await request(app)
      .get("/applicants/units")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  // W0 — AMI tier filter coverage. The filter is the backend half of the
  // landing → apply → discover cold-open: visitor types income on the
  // welcome calculator, the tier flows into `qualifyingAmiTier`, and the
  // unit list shows only set-asides at-or-above that tier.
  describe("?amiTier= filter (W0)", () => {
    it("with amiTier=50 — restricts set-aside whitelist to ['50','60','80']% AMI", async () => {
      mockUsersRow(applicant, VERIFIED_AT);
      mockQuery.mockResolvedValueOnce({ rows: [] } as any);
      const token = generateToken(applicant);
      const res = await request(app)
        .get("/applicants/units?amiTier=50")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      const sql = mockQuery.mock.calls[1][0] as string;
      const params = mockQuery.mock.calls[1][1] as unknown[];
      // The legacy text whitelist (param $1) is preserved for zero regression,
      // PLUS a rent_schedule-derived branch (param $2 = the applicant tier as an
      // int) so a 40/45%/market property — whose ami_set_aside text never matched
      // the fixed whitelist — is now reachable. Null/empty set-aside stays visible.
      expect(sql).toContain("p.ami_set_aside = ANY($1)");
      expect(sql).toContain("p.ami_set_aside IS NULL OR p.ami_set_aside = ''");
      expect(sql).toContain("jsonb_object_keys");
      expect(params).toEqual([["50% AMI", "60% AMI", "80% AMI"], 50]);
    });

    it("with amiTier=30 — includes every higher tier in the whitelist", async () => {
      mockUsersRow(applicant, VERIFIED_AT);
      mockQuery.mockResolvedValueOnce({ rows: [] } as any);
      const token = generateToken(applicant);
      const res = await request(app)
        .get("/applicants/units?amiTier=30")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      const params = mockQuery.mock.calls[1][1] as unknown[];
      expect(params).toEqual([["30% AMI", "50% AMI", "60% AMI", "80% AMI"], 30]);
    });

    it("with amiTier=80 — whitelist contains only the top tier", async () => {
      mockUsersRow(applicant, VERIFIED_AT);
      mockQuery.mockResolvedValueOnce({ rows: [] } as any);
      const token = generateToken(applicant);
      const res = await request(app)
        .get("/applicants/units?amiTier=80")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      const params = mockQuery.mock.calls[1][1] as unknown[];
      expect(params).toEqual([["80% AMI"], 80]);
    });

    it("reaches 40/45% + market properties via rent_schedule (the Donna Louise 2 fix)", async () => {
      mockUsersRow(applicant, VERIFIED_AT);
      mockQuery.mockResolvedValueOnce({ rows: [] } as any);
      const token = generateToken(applicant);
      const res = await request(app)
        .get("/applicants/units?amiTier=30")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      const sql = mockQuery.mock.calls[1][0] as string;
      // A 40/45% building is reached by parsing its rent_schedule keys (the same
      // source screening/compliance.ts uses), not the fixed whitelist; and any
      // "*market*" tier keeps uncapped units visible to every applicant.
      expect(sql).toContain("jsonb_object_keys");
      expect(sql).toContain("~* 'market'");
    });

    it("rejects an invalid amiTier value with 400 (loud, not silent drop)", async () => {
      mockUsersRow(applicant, VERIFIED_AT);
      const token = generateToken(applicant);
      const res = await request(app)
        .get("/applicants/units?amiTier=70")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid amiTier/i);
      expect(res.body.allowed).toEqual(["30", "50", "60", "80"]);
      // No DB query should have been issued for the units fetch (auth row is
      // already shifted off the queue at this point).
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it("rejects garbage strings with 400 (no SQL injection vector)", async () => {
      mockUsersRow(applicant, VERIFIED_AT);
      const token = generateToken(applicant);
      const res = await request(app)
        .get("/applicants/units?amiTier=' OR '1'='1")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(400);
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it("without amiTier — returns the full list (no AMI condition appended)", async () => {
      mockUsersRow(applicant, VERIFIED_AT);
      mockQuery.mockResolvedValueOnce({
        rows: [
          { id: "u1", monthly_rent: 1500 },
          { id: "u2", monthly_rent: 1600 },
        ],
      } as any);
      const token = generateToken(applicant);
      const res = await request(app)
        .get("/applicants/units")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.units).toHaveLength(2);
      const sql = mockQuery.mock.calls[1][0] as string;
      expect(sql).not.toMatch(/p\.ami_set_aside = ANY/);
    });
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
      { rows: [] },                                         // SELECT pg_advisory_xact_lock
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
      { rows: [] }, // SELECT pg_advisory_xact_lock
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
      { rows: [] }, // SELECT pg_advisory_xact_lock
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
    mockTxnWithQueue([
      { rows: [] }, // SELECT pg_advisory_xact_lock
      { rows: [] }, // SELECT units → empty
    ]);
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
        { rows: [] },                                       // SELECT pg_advisory_xact_lock
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

  // Regression for merged_bug_003: without a per-user advisory lock, two tabs
  // can claim two different units, FOR UPDATE-lock different rows, both read
  // the same prior draft state, and orphan a unit in 'held'. The lock must
  // be acquired BEFORE the units FOR UPDATE so the second tab waits.
  it("acquires per-user advisory lock before locking the unit row", async () => {
    mockUsersRow(applicant, VERIFIED_AT);
    const calls: Array<[string, any[] | undefined]> = [];
    mockTransaction.mockImplementationOnce(async (fn: any) => {
      const queue: Array<{ rows: any[] }> = [
        { rows: [] },                                                                                             // advisory lock
        { rows: [{ id: VALID_UNIT, property_id: PROPERTY_ID, status: "available", claim_expires_at: null }] },
        { rows: [{ id: "app-001", claimed_unit_id: null }] },
        { rows: [] },
        { rows: [] },
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

    expect(calls[0][0]).toMatch(/pg_advisory_xact_lock\(hashtext\(\$1\)\)/);
    expect(calls[0][1]).toEqual([`claim-unit:${applicant.id}`]);
    // FOR UPDATE on the unit must come AFTER the advisory lock — otherwise
    // two tabs can both pass the unit-lock for different units.
    const advisoryIdx = calls.findIndex(([sql]) => /pg_advisory_xact_lock/.test(sql));
    const forUpdateIdx = calls.findIndex(([sql]) => /FROM units[\s\S]*FOR UPDATE/.test(sql));
    expect(advisoryIdx).toBeGreaterThanOrEqual(0);
    expect(forUpdateIdx).toBeGreaterThan(advisoryIdx);
  });

  // Regression for issue #15 Bug 1 (cross-user clobber). Setup: User A's
  // draft still points at PRIOR_UNIT with the original 48h expiry, but that
  // hold has lapsed and User B has since re-claimed PRIOR_UNIT with a NEW
  // expiry. When A now claims VALID_UNIT, the prior-unit release UPDATE must
  // be gated on the (status='held', claim_expires_at = $priorExpiresAt)
  // predicate so it cannot touch B's active hold. We assert the actual SQL
  // shape since this is the only deterministic way to verify the gate
  // without spinning up Postgres.
  it("guards prior-unit release with holder+expiry predicate (issue #15 Bug 1)", async () => {
    mockUsersRow(applicant, VERIFIED_AT);
    const PRIOR_UNIT = "550e8400-e29b-41d4-a716-446655440099";
    const ORIGINAL_EXPIRY = new Date("2026-05-19T00:00:00Z").toISOString();
    const calls: Array<[string, any[] | undefined]> = [];
    mockTransaction.mockImplementationOnce(async (fn: any) => {
      const queue: Array<{ rows: any[] }> = [
        { rows: [] },                                                                          // advisory lock
        { rows: [{ id: VALID_UNIT, property_id: PROPERTY_ID, status: "available", claim_expires_at: null }] },
        { rows: [{ id: "app-001", claimed_unit_id: PRIOR_UNIT, claim_expires_at: ORIGINAL_EXPIRY }] },
        { rows: [] }, // guarded UPDATE on PRIOR_UNIT — assumed no-op in real DB if B now holds it
        { rows: [] }, // UPDATE units (new claim → held)
        { rows: [] }, // UPDATE applications
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

    // The prior-unit release UPDATE must include status + expiry predicates,
    // and must pass the expected priorExpiresAt as $2. An unguarded UPDATE
    // (the pre-fix code) would have neither.
    const releaseCall = calls.find(([sql]) =>
      /UPDATE units\s+SET status = 'available'/.test(sql) &&
      /WHERE id = \$1/.test(sql)
    );
    expect(releaseCall).toBeDefined();
    const [releaseSql, releaseParams] = releaseCall!;
    expect(releaseSql).toMatch(/AND\s+status\s*=\s*'held'/);
    expect(releaseSql).toMatch(/AND\s+claim_expires_at\s+IS\s+NOT\s+DISTINCT\s+FROM\s+\$2/i);
    expect(releaseParams).toEqual([PRIOR_UNIT, ORIGINAL_EXPIRY]);

    // And the draft SELECT must surface claim_expires_at (so the route has
    // the value to bind) and lock the row with FOR UPDATE.
    const draftSelect = calls.find(([sql]) =>
      /FROM user_applications/.test(sql) && /JOIN applications/.test(sql)
    );
    expect(draftSelect![0]).toMatch(/a\.claim_expires_at/);
    expect(draftSelect![0]).toMatch(/FOR UPDATE OF a/);
  });

  // Issue #15 Bug 2 (concurrent same-user leak): even with the per-user
  // advisory lock, the draft SELECT must also FOR UPDATE the application
  // row so the prior-unit pointer we read at the top of the txn is the same
  // row we write at the bottom. (Tested via SQL shape — true parallel-tab
  // races would need two pool connections.) See the test "acquires per-user
  // advisory lock before locking the unit row" above for the lock-ordering
  // half of Bug 2's defense.
  it("locks the draft application row with FOR UPDATE (issue #15 Bug 2)", async () => {
    mockUsersRow(applicant, VERIFIED_AT);
    const calls: Array<[string, any[] | undefined]> = [];
    mockTransaction.mockImplementationOnce(async (fn: any) => {
      const queue: Array<{ rows: any[] }> = [
        { rows: [] }, // advisory lock
        { rows: [{ id: VALID_UNIT, property_id: PROPERTY_ID, status: "available", claim_expires_at: null }] },
        { rows: [{ id: "app-001", claimed_unit_id: null, claim_expires_at: null }] },
        { rows: [] },
        { rows: [] },
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

    const draftSelect = calls.find(([sql]) =>
      /FROM user_applications/.test(sql) && /JOIN applications/.test(sql)
    );
    expect(draftSelect).toBeDefined();
    expect(draftSelect![0]).toMatch(/FOR UPDATE OF a/);
  });

  it("creates a draft when claiming with none yet", async () => {
    mockUsersRow(applicant, VERIFIED_AT);
    mockTxnWithQueue([
      { rows: [] }, // SELECT pg_advisory_xact_lock
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
        { rows: [] }, // SELECT pg_advisory_xact_lock
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

  // Companion to the claim-side regression — release must also serialize per
  // user so it can't race a concurrent claim from another tab.
  it("acquires per-user advisory lock before reading the draft", async () => {
    mockUsersRow(applicant, VERIFIED_AT);
    const calls: Array<[string, any[] | undefined]> = [];
    mockTransaction.mockImplementationOnce(async (fn: any) => {
      const queue: Array<{ rows: any[] }> = [
        { rows: [] },                                                  // advisory lock
        { rows: [{ id: "app-001", claimed_unit_id: "unit-XYZ" }] },
        { rows: [] },
        { rows: [] },
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
    expect(calls[0][0]).toMatch(/pg_advisory_xact_lock\(hashtext\(\$1\)\)/);
    expect(calls[0][1]).toEqual([`claim-unit:${applicant.id}`]);
  });

  // Issue #15 Bug 1 companion: DELETE must use the same holder+expiry guard
  // so an explicit release can't clobber a different user's hold that took
  // over after the original lazy-expired.
  it("guards release with holder+expiry predicate (issue #15 Bug 1)", async () => {
    mockUsersRow(applicant, VERIFIED_AT);
    const ORIGINAL_EXPIRY = new Date("2026-05-19T00:00:00Z").toISOString();
    const calls: Array<[string, any[] | undefined]> = [];
    mockTransaction.mockImplementationOnce(async (fn: any) => {
      const queue: Array<{ rows: any[] }> = [
        { rows: [] }, // advisory lock
        { rows: [{ id: "app-001", claimed_unit_id: "unit-XYZ", claim_expires_at: ORIGINAL_EXPIRY }] },
        { rows: [] }, // UPDATE units
        { rows: [] }, // UPDATE applications
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

    const releaseCall = calls.find(([sql]) =>
      /UPDATE units\s+SET status = 'available'/.test(sql)
    );
    const [releaseSql, releaseParams] = releaseCall!;
    expect(releaseSql).toMatch(/AND\s+status\s*=\s*'held'/);
    expect(releaseSql).toMatch(/AND\s+claim_expires_at\s+IS\s+NOT\s+DISTINCT\s+FROM\s+\$2/i);
    expect(releaseParams).toEqual(["unit-XYZ", ORIGINAL_EXPIRY]);

    const draftSelect = calls.find(([sql]) =>
      /FROM user_applications/.test(sql) && /JOIN applications/.test(sql)
    );
    expect(draftSelect![0]).toMatch(/a\.claim_expires_at/);
    expect(draftSelect![0]).toMatch(/FOR UPDATE OF a/);
  });

  it("ok=true even when user has no active claim (idempotent)", async () => {
    mockUsersRow(applicant, VERIFIED_AT);
    mockTxnWithQueue([
      { rows: [] }, // SELECT pg_advisory_xact_lock
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
