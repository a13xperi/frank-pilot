/**
 * WARN #2 route-layer tests for src/modules/applicants/routes.ts.
 *
 * Covers the two-tier scope cutover:
 *   - POST /applicants/register issues a token with emailVerified=false
 *   - POST /applicants/apply is gated by requireEmailVerified (returns
 *     403 + code "EMAIL_UNVERIFIED" for an unverified applicant)
 *   - After verifyMagicLink stamps users.email_verified_at, /apply is
 *     reachable and the application is created.
 *
 * Auth strategy: real JWTs decoded against the mocked users DB row.
 * Service strategy: ApplicationService.create is mocked so this stays a
 * route-layer test (service-level concerns are covered elsewhere).
 */
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { generateToken, AuthUser } from "../middleware/auth";

jest.mock("../config/database", () => ({ query: jest.fn(), transaction: jest.fn() }));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockCreate = jest.fn();
jest.mock("../modules/application/service", () => ({
  ApplicationService: jest.fn().mockImplementation(() => ({
    create: mockCreate,
  })),
}));

// magic-link-service is invoked by /register — stub it so the route stops
// at JWT issuance without touching the (mocked) DB-token flow.
const mockCreateMagicLink = jest.fn();
const mockLogMagicLink = jest.fn();
jest.mock("../modules/auth/magic-link-service", () => ({
  createMagicLink: mockCreateMagicLink,
  logMagicLink: mockLogMagicLink,
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

function decode(token: string): any {
  return jwt.decode(token);
}

/** Stub the users row that authenticate() reads. */
function mockUsersRow(user: Partial<AuthUser> & { id: string; email: string; role: string }, emailVerifiedAt: Date | null) {
  mockQuery.mockResolvedValueOnce({
    rows: [
      {
        id: user.id,
        email: user.email,
        role: user.role,
        first_name: user.firstName ?? "Test",
        last_name: user.lastName ?? "User",
        property_ids: user.propertyIds ?? [],
        is_active: true,
        email_verified_at: emailVerifiedAt,
      },
    ],
  } as any);
}

describe("POST /applicants/register (WARN #2)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("issues a JWT with emailVerified=false for a brand-new account", async () => {
    // Existence check — no user yet.
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);
    // INSERT users
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "new-user-001" }] } as any);
    // SELECT after insert (route reads the row to build AuthUser)
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: "new-user-001",
        email: "victim@example.com",
        role: "applicant",
        first_name: "Vic",
        last_name: "Tim",
      }],
    } as any);
    mockCreateMagicLink.mockResolvedValueOnce({ link: "http://localhost:5174/auth/callback?token=raw", userId: "new-user-001" });

    const res = await request(app)
      .post("/applicants/register")
      .send({ email: "victim@example.com", firstName: "Vic", lastName: "Tim" });

    expect(res.status).toBe(202);
    expect(res.body.token).toBeDefined();
    const claims = decode(res.body.token);
    expect(claims.emailVerified).toBe(false);
    expect(claims.id).toBe("new-user-001");
    expect(claims.role).toBe("applicant");
  });

  it("never returns a token for a pre-existing applicant account", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: "existing-001", role: "applicant", is_active: true }],
    } as any);
    mockCreateMagicLink.mockResolvedValueOnce({ link: "http://x/auth/callback?token=raw", userId: "existing-001" });

    const res = await request(app)
      .post("/applicants/register")
      .send({ email: "existing@example.com", firstName: "Ex", lastName: "Ists" });

    expect(res.status).toBe(202);
    expect(res.body.token).toBeUndefined();
  });
});

describe("POST /applicants/apply (WARN #2 gate)", () => {
  beforeEach(() => jest.clearAllMocks());

  const applicant: AuthUser = {
    id: "applicant-001",
    email: "a@x.com",
    role: "applicant",
    firstName: "Ann",
    lastName: "App",
    propertyIds: [],
    emailVerified: false,
  };

  it("returns 403 with code EMAIL_UNVERIFIED when applicant has not verified", async () => {
    mockUsersRow(applicant, null);
    const token = generateToken(applicant, { emailVerified: false });
    const res = await request(app)
      .post("/applicants/apply")
      .set("Authorization", `Bearer ${token}`)
      .send({
        propertyId: "550e8400-e29b-41d4-a716-446655440000",
        firstName: "Ann",
        lastName: "App",
        ssn: "111-22-3333",
        dateOfBirth: "1990-01-01",
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/verification/i);
    expect(res.body.code).toBe("EMAIL_UNVERIFIED");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("ignores a forged emailVerified=true claim when DB says not verified", async () => {
    mockUsersRow(applicant, null);
    // Attacker claims verified — DB says no — DB wins.
    const token = generateToken(applicant, { emailVerified: true });
    const res = await request(app)
      .post("/applicants/apply")
      .set("Authorization", `Bearer ${token}`)
      .send({
        propertyId: "550e8400-e29b-41d4-a716-446655440000",
        firstName: "Ann",
        lastName: "App",
        ssn: "111-22-3333",
        dateOfBirth: "1990-01-01",
      });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("EMAIL_UNVERIFIED");
  });

  it("accepts a verified applicant and delegates to ApplicationService.create", async () => {
    mockUsersRow(applicant, new Date("2026-05-13T00:00:00Z"));
    mockCreate.mockResolvedValueOnce({ id: "app-001", status: "draft", created_at: new Date() });
    // INSERT user_applications join
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);

    const token = generateToken(applicant, { emailVerified: false }); // stale token; DB upgrades it
    const res = await request(app)
      .post("/applicants/apply")
      .set("Authorization", `Bearer ${token}`)
      .send({
        propertyId: "550e8400-e29b-41d4-a716-446655440000",
        firstName: "Ann",
        lastName: "App",
        ssn: "111-22-3333",
        dateOfBirth: "1990-01-01",
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe("app-001");
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});

describe("GET /applicants/me/applications (WARN #2 gate)", () => {
  beforeEach(() => jest.clearAllMocks());

  const tenant: AuthUser = {
    id: "tenant-001",
    email: "t@x.com",
    role: "tenant",
    firstName: "T",
    lastName: "T",
    propertyIds: [],
    emailVerified: false,
  };

  it("returns 403 EMAIL_UNVERIFIED for unverified tenant", async () => {
    mockUsersRow(tenant, null);
    const token = generateToken(tenant, { emailVerified: false });
    const res = await request(app)
      .get("/applicants/me/applications")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("EMAIL_UNVERIFIED");
  });

  it("returns the application list when verified", async () => {
    mockUsersRow(tenant, new Date());
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "app-9", first_name: "T" }] } as any);
    const token = generateToken(tenant, { emailVerified: true });
    const res = await request(app)
      .get("/applicants/me/applications")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.applications).toHaveLength(1);
  });
});

describe("GET /applicants/properties (public, ungated)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("does not require any authentication", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "prop-1", name: "Sunny Hills" }] } as any);
    const res = await request(app).get("/applicants/properties");
    expect(res.status).toBe(200);
    expect(res.body.properties).toHaveLength(1);
  });
});
