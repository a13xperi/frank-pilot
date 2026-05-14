/**
 * Route-layer tests for src/modules/approval/routes.ts
 *
 * Tests HTTP contract: status codes, auth enforcement, Zod validation errors,
 * service delegation, RBAC tier enforcement, and error propagation.
 *
 * Auth strategy: real JWT tokens + mock the users DB query that `authenticate`
 * runs on every request — exercises actual auth middleware.
 *
 * Service strategy: mock ApprovalService at module level (instantiated at route
 * scope) — isolates route layer from DB concerns covered in service tests.
 *
 * RBAC facts under test:
 *   approval:tier1 → senior_manager, regional_manager, asset_manager, system_admin
 *   approval:tier2 → regional_manager, asset_manager, system_admin
 *   approval:tier3 → asset_manager, system_admin
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

const mockTier1Review = jest.fn();
const mockTier2Review = jest.fn();
const mockTier3Review = jest.fn();
const mockGetApprovalStatus = jest.fn();

jest.mock("../modules/approval/service", () => ({
  ApprovalService: jest.fn().mockImplementation(() => ({
    tier1Review: mockTier1Review,
    tier2Review: mockTier2Review,
    tier3Review: mockTier3Review,
    getApprovalStatus: mockGetApprovalStatus,
  })),
}));

import { query } from "../config/database";
import approvalRouter from "../modules/approval/routes";

const mockQuery = query as jest.MockedFunction<typeof query>;

// ── Test users ─────────────────────────────────────────────────────────────

const leasingAgent: AuthUser = {
  id: "user-la-001",
  email: "agent@example.com",
  role: "leasing_agent",
  firstName: "Alice",
  lastName: "Agent",
  propertyIds: ["prop-001"],
  emailVerified: true,
};

const seniorManager: AuthUser = {
  id: "user-sm-001",
  email: "sm@example.com",
  role: "senior_manager",
  firstName: "Bob",
  lastName: "Manager",
  propertyIds: ["prop-001"],
  emailVerified: true,
};

const regionalManager: AuthUser = {
  id: "user-rm-001",
  email: "rm@example.com",
  role: "regional_manager",
  firstName: "Carol",
  lastName: "Regional",
  propertyIds: ["prop-001"],
  emailVerified: true,
};

const assetManager: AuthUser = {
  id: "user-am-001",
  email: "am@example.com",
  role: "asset_manager",
  firstName: "Dave",
  lastName: "Asset",
  propertyIds: ["prop-001"],
  emailVerified: true,
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
  app.use("/approval", approvalRouter);
  return app;
}

const app = buildApp();

/** Valid approval body — decision + required notes. */
function validApprovalBody(decision: "pass" | "fail" = "pass") {
  return { decision, notes: "Application looks good." };
}

// ── POST /:applicationId/tier1 ─────────────────────────────────────────────

describe("POST /approval/:applicationId/tier1", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 when no Authorization header is provided", async () => {
    const res = await request(app)
      .post("/approval/app-001/tier1")
      .send(validApprovalBody());
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/authentication required/i);
  });

  it("returns 401 when token is invalid", async () => {
    const res = await request(app)
      .post("/approval/app-001/tier1")
      .set("Authorization", "Bearer bad.token.here")
      .send(validApprovalBody());
    expect(res.status).toBe(401);
  });

  it("returns 403 when leasing_agent attempts tier1 review", async () => {
    mockAuthQuery(leasingAgent);

    const res = await request(app)
      .post("/approval/app-001/tier1")
      .set("Authorization", tokenFor(leasingAgent))
      .send(validApprovalBody());

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/insufficient permissions/i);
  });

  it("returns 400 when decision is missing from body", async () => {
    mockAuthQuery(seniorManager);

    const res = await request(app)
      .post("/approval/app-001/tier1")
      .set("Authorization", tokenFor(seniorManager))
      .send({ notes: "Some notes" }); // missing decision

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/validation failed/i);
    expect(res.body.details).toBeDefined();
  });

  it("returns 400 when notes is missing from body", async () => {
    mockAuthQuery(seniorManager);

    const res = await request(app)
      .post("/approval/app-001/tier1")
      .set("Authorization", tokenFor(seniorManager))
      .send({ decision: "pass" }); // missing notes

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/validation failed/i);
  });

  it("returns 400 when notes is an empty string", async () => {
    mockAuthQuery(seniorManager);

    const res = await request(app)
      .post("/approval/app-001/tier1")
      .set("Authorization", tokenFor(seniorManager))
      .send({ decision: "pass", notes: "" });

    expect(res.status).toBe(400);
  });

  it("returns 400 when decision is not pass or fail", async () => {
    mockAuthQuery(seniorManager);

    const res = await request(app)
      .post("/approval/app-001/tier1")
      .set("Authorization", tokenFor(seniorManager))
      .send({ decision: "approve", notes: "Some notes" });

    expect(res.status).toBe(400);
  });

  it("returns 200 with result when senior_manager approves tier1", async () => {
    mockAuthQuery(seniorManager);
    mockTier1Review.mockResolvedValue({ status: "tier1_approved" });

    const res = await request(app)
      .post("/approval/app-001/tier1")
      .set("Authorization", tokenFor(seniorManager))
      .send(validApprovalBody("pass"));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("tier1_approved");
  });

  it("passes correct args to service.tier1Review", async () => {
    mockAuthQuery(seniorManager);
    mockTier1Review.mockResolvedValue({ status: "tier1_denied" });

    await request(app)
      .post("/approval/app-001/tier1")
      .set("Authorization", tokenFor(seniorManager))
      .send({ decision: "fail", notes: "Income not verified." });

    expect(mockTier1Review).toHaveBeenCalledWith({
      applicationId: "app-001",
      decision: "fail",
      notes: "Income not verified.",
      reviewerId: seniorManager.id,
      reviewerRole: seniorManager.role,
    });
  });

  it("returns 400 when service.tier1Review throws", async () => {
    mockAuthQuery(seniorManager);
    mockTier1Review.mockRejectedValue(new Error("Application not in screening_passed status"));

    const res = await request(app)
      .post("/approval/app-001/tier1")
      .set("Authorization", tokenFor(seniorManager))
      .send(validApprovalBody());

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/screening_passed/i);
  });

  it("allows regional_manager to do tier1 review", async () => {
    mockAuthQuery(regionalManager);
    mockTier1Review.mockResolvedValue({ status: "tier2_review" });

    const res = await request(app)
      .post("/approval/app-001/tier1")
      .set("Authorization", tokenFor(regionalManager))
      .send(validApprovalBody());

    expect(res.status).toBe(200);
  });
});

// ── POST /:applicationId/tier2 ─────────────────────────────────────────────

describe("POST /approval/:applicationId/tier2", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 when no token provided", async () => {
    const res = await request(app)
      .post("/approval/app-001/tier2")
      .send(validApprovalBody());
    expect(res.status).toBe(401);
  });

  it("returns 403 when leasing_agent attempts tier2 review", async () => {
    mockAuthQuery(leasingAgent);

    const res = await request(app)
      .post("/approval/app-001/tier2")
      .set("Authorization", tokenFor(leasingAgent))
      .send(validApprovalBody());

    expect(res.status).toBe(403);
  });

  it("returns 403 when senior_manager attempts tier2 review (insufficient role)", async () => {
    mockAuthQuery(seniorManager);

    const res = await request(app)
      .post("/approval/app-001/tier2")
      .set("Authorization", tokenFor(seniorManager))
      .send(validApprovalBody());

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/insufficient permissions/i);
  });

  it("returns 400 when Zod validation fails (missing notes)", async () => {
    mockAuthQuery(regionalManager);

    const res = await request(app)
      .post("/approval/app-001/tier2")
      .set("Authorization", tokenFor(regionalManager))
      .send({ decision: "pass" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/validation failed/i);
  });

  it("returns 200 when regional_manager submits valid tier2 review", async () => {
    mockAuthQuery(regionalManager);
    mockTier2Review.mockResolvedValue({ status: "tier2_approved" });

    const res = await request(app)
      .post("/approval/app-001/tier2")
      .set("Authorization", tokenFor(regionalManager))
      .send(validApprovalBody());

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("tier2_approved");
  });

  it("passes correct args to service.tier2Review", async () => {
    mockAuthQuery(regionalManager);
    mockTier2Review.mockResolvedValue({ status: "tier2_denied" });

    await request(app)
      .post("/approval/app-001/tier2")
      .set("Authorization", tokenFor(regionalManager))
      .send({ decision: "fail", notes: "High rent-to-income ratio." });

    expect(mockTier2Review).toHaveBeenCalledWith({
      applicationId: "app-001",
      decision: "fail",
      notes: "High rent-to-income ratio.",
      reviewerId: regionalManager.id,
      reviewerRole: regionalManager.role,
    });
  });

  it("returns 400 when service.tier2Review throws", async () => {
    mockAuthQuery(regionalManager);
    mockTier2Review.mockRejectedValue(new Error("Application not in tier2_review status"));

    const res = await request(app)
      .post("/approval/app-001/tier2")
      .set("Authorization", tokenFor(regionalManager))
      .send(validApprovalBody());

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/tier2_review/i);
  });

  it("allows asset_manager to do tier2 review", async () => {
    mockAuthQuery(assetManager);
    mockTier2Review.mockResolvedValue({ status: "tier3_review" });

    const res = await request(app)
      .post("/approval/app-001/tier2")
      .set("Authorization", tokenFor(assetManager))
      .send(validApprovalBody());

    expect(res.status).toBe(200);
  });
});

// ── POST /:applicationId/tier3 ─────────────────────────────────────────────

describe("POST /approval/:applicationId/tier3", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 when no token provided", async () => {
    const res = await request(app)
      .post("/approval/app-001/tier3")
      .send(validApprovalBody());
    expect(res.status).toBe(401);
  });

  it("returns 403 when leasing_agent attempts tier3 review", async () => {
    mockAuthQuery(leasingAgent);

    const res = await request(app)
      .post("/approval/app-001/tier3")
      .set("Authorization", tokenFor(leasingAgent))
      .send(validApprovalBody());

    expect(res.status).toBe(403);
  });

  it("returns 403 when senior_manager attempts tier3 review", async () => {
    mockAuthQuery(seniorManager);

    const res = await request(app)
      .post("/approval/app-001/tier3")
      .set("Authorization", tokenFor(seniorManager))
      .send(validApprovalBody());

    expect(res.status).toBe(403);
  });

  it("returns 403 when regional_manager attempts tier3 review (insufficient role)", async () => {
    mockAuthQuery(regionalManager);

    const res = await request(app)
      .post("/approval/app-001/tier3")
      .set("Authorization", tokenFor(regionalManager))
      .send(validApprovalBody());

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/insufficient permissions/i);
  });

  it("returns 400 when Zod validation fails (invalid decision enum)", async () => {
    mockAuthQuery(assetManager);

    const res = await request(app)
      .post("/approval/app-001/tier3")
      .set("Authorization", tokenFor(assetManager))
      .send({ decision: "maybe", notes: "Not sure." });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/validation failed/i);
  });

  it("returns 200 when asset_manager submits valid tier3 review", async () => {
    mockAuthQuery(assetManager);
    mockTier3Review.mockResolvedValue({ status: "approved" });

    const res = await request(app)
      .post("/approval/app-001/tier3")
      .set("Authorization", tokenFor(assetManager))
      .send(validApprovalBody());

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("approved");
  });

  it("passes correct args to service.tier3Review", async () => {
    mockAuthQuery(assetManager);
    mockTier3Review.mockResolvedValue({ status: "denied" });

    await request(app)
      .post("/approval/app-001/tier3")
      .set("Authorization", tokenFor(assetManager))
      .send({ decision: "fail", notes: "Does not meet asset management criteria." });

    expect(mockTier3Review).toHaveBeenCalledWith({
      applicationId: "app-001",
      decision: "fail",
      notes: "Does not meet asset management criteria.",
      reviewerId: assetManager.id,
      reviewerRole: assetManager.role,
    });
  });

  it("returns 400 when service.tier3Review throws", async () => {
    mockAuthQuery(assetManager);
    mockTier3Review.mockRejectedValue(new Error("Separation of duties violation"));

    const res = await request(app)
      .post("/approval/app-001/tier3")
      .set("Authorization", tokenFor(assetManager))
      .send(validApprovalBody());

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/separation of duties/i);
  });
});

// ── GET /:applicationId/status ─────────────────────────────────────────────

describe("GET /approval/:applicationId/status", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 when no token provided", async () => {
    const res = await request(app).get("/approval/app-001/status");
    expect(res.status).toBe(401);
  });

  it("returns 200 with status for leasing_agent (application:read is open to all roles)", async () => {
    mockAuthQuery(leasingAgent);
    mockGetApprovalStatus.mockResolvedValue({ applicationId: "app-001", status: "tier1_review" });

    const res = await request(app)
      .get("/approval/app-001/status")
      .set("Authorization", tokenFor(leasingAgent));

    expect(res.status).toBe(200);
    expect(res.body.applicationId).toBe("app-001");
    expect(res.body.status).toBe("tier1_review");
  });

  it("returns 200 with status for senior_manager", async () => {
    mockAuthQuery(seniorManager);
    mockGetApprovalStatus.mockResolvedValue({ applicationId: "app-001", status: "approved" });

    const res = await request(app)
      .get("/approval/app-001/status")
      .set("Authorization", tokenFor(seniorManager));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("approved");
  });

  it("passes the application ID to service.getApprovalStatus", async () => {
    mockAuthQuery(seniorManager);
    mockGetApprovalStatus.mockResolvedValue({ applicationId: "app-xyz", status: "denied" });

    await request(app)
      .get("/approval/app-xyz/status")
      .set("Authorization", tokenFor(seniorManager));

    expect(mockGetApprovalStatus).toHaveBeenCalledWith("app-xyz");
  });

  it("returns 400 when service.getApprovalStatus throws", async () => {
    mockAuthQuery(seniorManager);
    mockGetApprovalStatus.mockRejectedValue(new Error("Application not found"));

    const res = await request(app)
      .get("/approval/app-001/status")
      .set("Authorization", tokenFor(seniorManager));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not found/i);
  });
});
