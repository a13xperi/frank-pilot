/**
 * Route-layer tests for the tenant lease e-signature endpoints in
 * src/modules/applicants/routes.ts:
 *
 *   GET  /applicants/me/lease       — current lease (status + doc + signature state)
 *   POST /applicants/me/lease/sign  — tenant signs (lease_generated → lease_signed)
 *
 * These are ownership-gated (user_applications), NOT RBAC: only the applicant /
 * tenant who owns the application may read or sign it.
 *
 * Auth strategy mirrors lease-routes.test.ts: real JWTs + mock the users DB
 * lookup that authenticate() runs. Applicants must be email-verified, so the
 * mocked user row carries email_verified_at.
 *
 * Service strategy: LeaseService is mocked at module scope — the route layer is
 * isolated from DB/transition logic (covered in lease-service.test.ts).
 */

import express from "express";
import request from "supertest";
import { generateToken, AuthUser } from "../middleware/auth";

jest.mock("../config/database", () => ({ query: jest.fn(), transaction: jest.fn() }));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockGetLeaseStatus = jest.fn();
const mockSignLease = jest.fn();

jest.mock("../modules/lease/service", () => ({
  LeaseService: jest.fn().mockImplementation(() => ({
    getLeaseStatus: mockGetLeaseStatus,
    signLease: mockSignLease,
  })),
}));

import { query } from "../config/database";
import applicantsRouter from "../modules/applicants/routes";

const mockQuery = query as jest.MockedFunction<typeof query>;

// ── Test users ───────────────────────────────────────────────────────────────

const applicant: AuthUser = {
  id: "user-app-001",
  email: "tenant@example.com",
  role: "applicant",
  firstName: "Jane",
  lastName: "Doe",
  propertyIds: [],
  emailVerified: true,
};

const leasingAgent: AuthUser = {
  id: "user-la-001",
  email: "agent@example.com",
  role: "leasing_agent",
  firstName: "Alice",
  lastName: "Agent",
  propertyIds: ["prop-001"],
  emailVerified: true,
};

function tokenFor(user: AuthUser): string {
  return `Bearer ${generateToken(user)}`;
}

/** Mock the users lookup authenticate() runs. Verified iff emailVerified. */
function mockAuthQuery(user: AuthUser) {
  mockQuery.mockResolvedValueOnce({
    rows: [
      {
        id: user.id,
        email: user.email,
        role: user.role,
        first_name: user.firstName,
        last_name: user.lastName,
        property_ids: user.propertyIds,
        is_active: true,
        email_verified_at: user.emailVerified ? new Date() : null,
      },
    ],
  } as any);
}

/** The user_applications ownership lookup (findUserLeaseApplicationId). */
function mockOwnershipQuery(applicationId: string | null) {
  mockQuery.mockResolvedValueOnce({
    rows: applicationId ? [{ id: applicationId }] : [],
  } as any);
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/applicants", applicantsRouter);
  return app;
}
const app = buildApp();

const validBody = {
  signatureName: "Jane Doe",
  signatureImage: "data:image/png;base64,AAAA",
  consent: true,
};

// ── GET /applicants/me/lease ───────────────────────────────────────────────────

describe("GET /applicants/me/lease", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/applicants/me/lease");
    expect(res.status).toBe(401);
  });

  it("returns 403 for a staff role (applicant-only route)", async () => {
    mockAuthQuery(leasingAgent);
    const res = await request(app)
      .get("/applicants/me/lease")
      .set("Authorization", tokenFor(leasingAgent));
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/applicant role/i);
  });

  it("returns 404 when the applicant has no lease-stage application", async () => {
    mockAuthQuery(applicant);
    mockOwnershipQuery(null);
    const res = await request(app)
      .get("/applicants/me/lease")
      .set("Authorization", tokenFor(applicant));
    expect(res.status).toBe(404);
    expect(mockGetLeaseStatus).not.toHaveBeenCalled();
  });

  it("returns 200 with the lease status for the owned application", async () => {
    mockAuthQuery(applicant);
    mockOwnershipQuery("app-001");
    mockGetLeaseStatus.mockResolvedValueOnce({
      applicationId: "app-001",
      status: "lease_generated",
      onesiteLeaseId: "ols_001",
      loftTenantId: null,
      autoPayEnrolled: false,
      documentUrl: "https://onesite.example.com/leases/ols_001",
      signed: false,
      signedAt: null,
      signerName: null,
    });

    const res = await request(app)
      .get("/applicants/me/lease")
      .set("Authorization", tokenFor(applicant));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("lease_generated");
    expect(res.body.documentUrl).toBe("https://onesite.example.com/leases/ols_001");
    expect(mockGetLeaseStatus).toHaveBeenCalledWith("app-001");
  });
});

// ── POST /applicants/me/lease/sign ──────────────────────────────────────────────

describe("POST /applicants/me/lease/sign", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).post("/applicants/me/lease/sign").send(validBody);
    expect(res.status).toBe(401);
  });

  it("returns 403 for a staff role", async () => {
    mockAuthQuery(leasingAgent);
    const res = await request(app)
      .post("/applicants/me/lease/sign")
      .set("Authorization", tokenFor(leasingAgent))
      .send(validBody);
    expect(res.status).toBe(403);
  });

  it("returns 400 when consent is missing (schema rejects)", async () => {
    mockAuthQuery(applicant);
    const res = await request(app)
      .post("/applicants/me/lease/sign")
      .set("Authorization", tokenFor(applicant))
      .send({ signatureName: "Jane Doe", signatureImage: "data:..." });
    expect(res.status).toBe(400);
    expect(mockSignLease).not.toHaveBeenCalled();
  });

  it("returns 400 when consent is explicitly false", async () => {
    mockAuthQuery(applicant);
    const res = await request(app)
      .post("/applicants/me/lease/sign")
      .set("Authorization", tokenFor(applicant))
      .send({ ...validBody, consent: false });
    expect(res.status).toBe(400);
    expect(mockSignLease).not.toHaveBeenCalled();
  });

  it("returns 404 when no lease is ready to sign", async () => {
    mockAuthQuery(applicant);
    mockOwnershipQuery(null);
    const res = await request(app)
      .post("/applicants/me/lease/sign")
      .set("Authorization", tokenFor(applicant))
      .send(validBody);
    expect(res.status).toBe(404);
    expect(mockSignLease).not.toHaveBeenCalled();
  });

  it("returns 200 and delegates to signLease with ownership + signer identity", async () => {
    mockAuthQuery(applicant);
    mockOwnershipQuery("app-001");
    mockSignLease.mockResolvedValueOnce({
      status: "lease_signed",
      signedAt: "2026-05-22T10:00:00.000Z",
      documentUrl: "https://onesite.example.com/leases/ols_001",
    });

    const res = await request(app)
      .post("/applicants/me/lease/sign")
      .set("Authorization", tokenFor(applicant))
      .send(validBody);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("lease_signed");
    expect(mockSignLease).toHaveBeenCalledWith(
      "app-001",
      { userId: "user-app-001", role: "applicant" },
      expect.objectContaining({
        signatureName: "Jane Doe",
        signatureImage: "data:image/png;base64,AAAA",
        consent: true,
      })
    );
  });

  it("maps a wrong-status signLease error to 400", async () => {
    mockAuthQuery(applicant);
    mockOwnershipQuery("app-001");
    mockSignLease.mockRejectedValueOnce(
      new Error("Application must be in lease_generated status to sign. Current status: onboarded")
    );

    const res = await request(app)
      .post("/applicants/me/lease/sign")
      .set("Authorization", tokenFor(applicant))
      .send(validBody);

    expect(res.status).toBe(400);
  });
});
