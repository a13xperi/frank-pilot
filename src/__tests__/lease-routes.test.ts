/**
 * Route-layer tests for src/modules/lease/routes.ts
 *
 * Tests HTTP contract: status codes, auth enforcement, service delegation,
 * RBAC enforcement, and error propagation.
 *
 * Auth strategy: real JWT tokens + mock the users DB query that `authenticate`
 * runs on every request — exercises actual auth middleware.
 *
 * Service strategy: mock LeaseService at module level (instantiated at route
 * scope) — isolates route layer from DB concerns covered in service tests.
 *
 * RBAC facts under test:
 *   lease:generate → senior_manager, regional_manager, asset_manager, system_admin
 *   application:read → all roles including leasing_agent
 */

import express from "express";
import request from "supertest";
import { generateToken, AuthUser } from "../middleware/auth";

// ── Mocks (must be declared before module imports) ─────────────────────────

jest.mock("../config/database", () => ({ query: jest.fn(), transaction: jest.fn() }));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockGenerateLease = jest.fn();
const mockCompleteOnboarding = jest.fn();
const mockGetLeaseStatus = jest.fn();

jest.mock("../modules/lease/service", () => ({
  LeaseService: jest.fn().mockImplementation(() => ({
    generateLease: mockGenerateLease,
    completeOnboarding: mockCompleteOnboarding,
    getLeaseStatus: mockGetLeaseStatus,
  })),
}));

import { query } from "../config/database";
import leaseRouter from "../modules/lease/routes";

const mockQuery = query as jest.MockedFunction<typeof query>;

// ── Test users ─────────────────────────────────────────────────────────────

const leasingAgent: AuthUser = {
  id: "user-la-001",
  email: "agent@example.com",
  role: "leasing_agent",
  firstName: "Alice",
  lastName: "Agent",
  propertyIds: ["prop-001"],
};

const seniorManager: AuthUser = {
  id: "user-sm-001",
  email: "sm@example.com",
  role: "senior_manager",
  firstName: "Bob",
  lastName: "Manager",
  propertyIds: ["prop-001"],
};

const regionalManager: AuthUser = {
  id: "user-rm-001",
  email: "rm@example.com",
  role: "regional_manager",
  firstName: "Carol",
  lastName: "Regional",
  propertyIds: ["prop-001"],
};

function tokenFor(user: AuthUser): string {
  return `Bearer ${generateToken(user)}`;
}

/** Mock the users DB query that authenticate() uses to verify an active user. */
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
      },
    ],
  } as any);
}

// ── Build test app ─────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/leases", leaseRouter);
  return app;
}

const app = buildApp();

// ── POST /:applicationId/generate ──────────────────────────────────────────

describe("POST /leases/:applicationId/generate", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 when no Authorization header is provided", async () => {
    const res = await request(app).post("/leases/app-001/generate");
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/authentication required/i);
  });

  it("returns 401 when token is invalid", async () => {
    const res = await request(app)
      .post("/leases/app-001/generate")
      .set("Authorization", "Bearer bad.token.here");
    expect(res.status).toBe(401);
  });

  it("returns 403 when leasing_agent attempts lease generation", async () => {
    mockAuthQuery(leasingAgent);

    const res = await request(app)
      .post("/leases/app-001/generate")
      .set("Authorization", tokenFor(leasingAgent));

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/insufficient permissions/i);
  });

  it("returns 200 with leaseId and documentUrl on success (senior_manager)", async () => {
    mockAuthQuery(seniorManager);
    mockGenerateLease.mockResolvedValueOnce({
      leaseId: "lease-001",
      documentUrl: "https://onesite.example.com/leases/lease-001.pdf",
    });

    const res = await request(app)
      .post("/leases/app-001/generate")
      .set("Authorization", tokenFor(seniorManager));

    expect(res.status).toBe(200);
    expect(res.body.leaseId).toBe("lease-001");
    expect(res.body.documentUrl).toBe("https://onesite.example.com/leases/lease-001.pdf");
  });

  it("returns 200 with leaseId and documentUrl on success (regional_manager)", async () => {
    mockAuthQuery(regionalManager);
    mockGenerateLease.mockResolvedValueOnce({
      leaseId: "lease-002",
      documentUrl: "https://onesite.example.com/leases/lease-002.pdf",
    });

    const res = await request(app)
      .post("/leases/app-002/generate")
      .set("Authorization", tokenFor(regionalManager));

    expect(res.status).toBe(200);
    expect(res.body.leaseId).toBe("lease-002");
  });

  it("forwards correct applicationId, actorId, and actorRole to service", async () => {
    mockAuthQuery(seniorManager);
    mockGenerateLease.mockResolvedValueOnce({
      leaseId: "lease-003",
      documentUrl: "https://example.com/doc",
    });

    await request(app)
      .post("/leases/app-999/generate")
      .set("Authorization", tokenFor(seniorManager));

    expect(mockGenerateLease).toHaveBeenCalledWith(
      "app-999",
      seniorManager.id,
      seniorManager.role
    );
  });

  it("returns 400 when service throws an error", async () => {
    mockAuthQuery(seniorManager);
    mockGenerateLease.mockRejectedValueOnce(
      new Error("Application must be in an approved status to generate a lease. Current status: submitted")
    );

    const res = await request(app)
      .post("/leases/app-001/generate")
      .set("Authorization", tokenFor(seniorManager));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/approved status/i);
  });

  it("returns 400 when application not found", async () => {
    mockAuthQuery(seniorManager);
    mockGenerateLease.mockRejectedValueOnce(new Error("Application not found"));

    const res = await request(app)
      .post("/leases/nonexistent/generate")
      .set("Authorization", tokenFor(seniorManager));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/application not found/i);
  });

  it("returns 400 when rent amount is missing", async () => {
    mockAuthQuery(seniorManager);
    mockGenerateLease.mockRejectedValueOnce(
      new Error("Application is missing requested rent amount")
    );

    const res = await request(app)
      .post("/leases/app-001/generate")
      .set("Authorization", tokenFor(seniorManager));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/missing requested rent amount/i);
  });
});

// ── POST /:applicationId/onboard ───────────────────────────────────────────

describe("POST /leases/:applicationId/onboard", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 when no Authorization header is provided", async () => {
    const res = await request(app).post("/leases/app-001/onboard");
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/authentication required/i);
  });

  it("returns 401 when token is invalid", async () => {
    const res = await request(app)
      .post("/leases/app-001/onboard")
      .set("Authorization", "Bearer invalid.token.value");
    expect(res.status).toBe(401);
  });

  it("returns 403 when leasing_agent attempts onboarding", async () => {
    mockAuthQuery(leasingAgent);

    const res = await request(app)
      .post("/leases/app-001/onboard")
      .set("Authorization", tokenFor(leasingAgent));

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/insufficient permissions/i);
  });

  it("returns 200 with onboarded and loftTenantId on success (senior_manager)", async () => {
    mockAuthQuery(seniorManager);
    mockCompleteOnboarding.mockResolvedValueOnce({
      onboarded: true,
      loftTenantId: "loft-tenant-001",
    });

    const res = await request(app)
      .post("/leases/app-001/onboard")
      .set("Authorization", tokenFor(seniorManager));

    expect(res.status).toBe(200);
    expect(res.body.onboarded).toBe(true);
    expect(res.body.loftTenantId).toBe("loft-tenant-001");
  });

  it("returns 200 with onboarded and loftTenantId on success (regional_manager)", async () => {
    mockAuthQuery(regionalManager);
    mockCompleteOnboarding.mockResolvedValueOnce({
      onboarded: true,
      loftTenantId: "loft-tenant-002",
    });

    const res = await request(app)
      .post("/leases/app-002/onboard")
      .set("Authorization", tokenFor(regionalManager));

    expect(res.status).toBe(200);
    expect(res.body.loftTenantId).toBe("loft-tenant-002");
  });

  it("forwards correct applicationId, actorId, and actorRole to service", async () => {
    mockAuthQuery(regionalManager);
    mockCompleteOnboarding.mockResolvedValueOnce({
      onboarded: true,
      loftTenantId: "loft-tenant-999",
    });

    await request(app)
      .post("/leases/app-888/onboard")
      .set("Authorization", tokenFor(regionalManager));

    expect(mockCompleteOnboarding).toHaveBeenCalledWith(
      "app-888",
      regionalManager.id,
      regionalManager.role
    );
  });

  it("returns 400 when application not in lease_generated status", async () => {
    mockAuthQuery(seniorManager);
    mockCompleteOnboarding.mockRejectedValueOnce(
      new Error(
        "Application must be in lease_generated status to complete onboarding. Current status: tier1_approved"
      )
    );

    const res = await request(app)
      .post("/leases/app-001/onboard")
      .set("Authorization", tokenFor(seniorManager));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/lease_generated status/i);
  });

  it("returns 400 when no OneSite lease ID is present", async () => {
    mockAuthQuery(seniorManager);
    mockCompleteOnboarding.mockRejectedValueOnce(
      new Error("Application has no OneSite lease ID — run generateLease first")
    );

    const res = await request(app)
      .post("/leases/app-001/onboard")
      .set("Authorization", tokenFor(seniorManager));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/OneSite lease ID/i);
  });

  it("returns 400 when application not found", async () => {
    mockAuthQuery(seniorManager);
    mockCompleteOnboarding.mockRejectedValueOnce(new Error("Application not found"));

    const res = await request(app)
      .post("/leases/nonexistent/onboard")
      .set("Authorization", tokenFor(seniorManager));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/application not found/i);
  });
});

// ── GET /:applicationId ────────────────────────────────────────────────────

describe("GET /leases/:applicationId", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 when no Authorization header is provided", async () => {
    const res = await request(app).get("/leases/app-001");
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/authentication required/i);
  });

  it("returns 401 when token is invalid", async () => {
    const res = await request(app)
      .get("/leases/app-001")
      .set("Authorization", "Bearer invalid.token.value");
    expect(res.status).toBe(401);
  });

  it("returns 200 with lease status for leasing_agent (application:read open to all roles)", async () => {
    mockAuthQuery(leasingAgent);
    mockGetLeaseStatus.mockResolvedValueOnce({
      applicationId: "app-001",
      status: "lease_generated",
      onesiteLeaseId: "os-lease-001",
      loftTenantId: null,
      autoPayEnrolled: false,
    });

    const res = await request(app)
      .get("/leases/app-001")
      .set("Authorization", tokenFor(leasingAgent));

    expect(res.status).toBe(200);
    expect(res.body.applicationId).toBe("app-001");
    expect(res.body.status).toBe("lease_generated");
    expect(res.body.onesiteLeaseId).toBe("os-lease-001");
    expect(res.body.loftTenantId).toBeNull();
    expect(res.body.autoPayEnrolled).toBe(false);
  });

  it("returns 200 with full onboarded status for senior_manager", async () => {
    mockAuthQuery(seniorManager);
    mockGetLeaseStatus.mockResolvedValueOnce({
      applicationId: "app-002",
      status: "onboarded",
      onesiteLeaseId: "os-lease-002",
      loftTenantId: "loft-tenant-002",
      autoPayEnrolled: true,
    });

    const res = await request(app)
      .get("/leases/app-002")
      .set("Authorization", tokenFor(seniorManager));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("onboarded");
    expect(res.body.loftTenantId).toBe("loft-tenant-002");
    expect(res.body.autoPayEnrolled).toBe(true);
  });

  it("returns 404 when application does not exist", async () => {
    mockAuthQuery(leasingAgent);
    mockGetLeaseStatus.mockResolvedValueOnce(null);

    const res = await request(app)
      .get("/leases/nonexistent")
      .set("Authorization", tokenFor(leasingAgent));

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/application not found/i);
  });

  it("returns 500 when service throws unexpectedly", async () => {
    mockAuthQuery(seniorManager);
    mockGetLeaseStatus.mockRejectedValueOnce(new Error("DB connection lost"));

    const res = await request(app)
      .get("/leases/app-001")
      .set("Authorization", tokenFor(seniorManager));

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to get lease status/i);
  });

  it("forwards correct applicationId to service", async () => {
    mockAuthQuery(leasingAgent);
    mockGetLeaseStatus.mockResolvedValueOnce({
      applicationId: "app-777",
      status: "tier1_approved",
      onesiteLeaseId: null,
      loftTenantId: null,
      autoPayEnrolled: false,
    });

    await request(app)
      .get("/leases/app-777")
      .set("Authorization", tokenFor(leasingAgent));

    expect(mockGetLeaseStatus).toHaveBeenCalledWith("app-777");
  });
});
