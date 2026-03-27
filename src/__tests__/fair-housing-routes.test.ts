/**
 * Route-layer tests for src/modules/compliance/routes.ts
 *
 * GET /api/compliance/fair-housing
 *
 * Auth strategy: real JWT tokens + mock the users DB query that `authenticate`
 * runs on every request — exercises actual auth middleware.
 *
 * Service strategy: mock FairHousingService at module level — isolates routes
 * from DB concerns covered in fair-housing-service.test.ts.
 *
 * RBAC fact:
 *   audit:view → regional_manager, asset_manager, system_admin
 *   leasing_agent and senior_manager are BLOCKED
 */

import express from "express";
import request from "supertest";
import { generateToken, AuthUser } from "../middleware/auth";

// ── Mocks (must be declared before module imports) ─────────────────────────

jest.mock("../config/database", () => ({ query: jest.fn(), transaction: jest.fn() }));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockGenerateReport = jest.fn();

jest.mock("../modules/compliance/fair-housing", () => ({
  FairHousingService: jest.fn().mockImplementation(() => ({
    generateReport: mockGenerateReport,
  })),
  OBJECTIVE_SCREENING_CRITERIA: [
    "Criminal background: auto-fail for felonies",
  ],
}));

import { query } from "../config/database";
import complianceRouter from "../modules/compliance/routes";

const mockQuery = query as jest.MockedFunction<typeof query>;

// ── Test users ─────────────────────────────────────────────────────────────

const leasingAgent: AuthUser = {
  id: "user-la-001",
  email: "agent@example.com",
  role: "leasing_agent",
  firstName: "Alice",
  lastName: "Agent",
  propertyIds: [],
};

const seniorManager: AuthUser = {
  id: "user-sm-001",
  email: "sm@example.com",
  role: "senior_manager",
  firstName: "Bob",
  lastName: "Manager",
  propertyIds: [],
};

const regionalManager: AuthUser = {
  id: "user-rm-001",
  email: "rm@example.com",
  role: "regional_manager",
  firstName: "Carol",
  lastName: "Regional",
  propertyIds: [],
};

function tokenFor(user: AuthUser): string {
  return `Bearer ${generateToken(user)}`;
}

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

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/compliance", complianceRouter);
  return app;
}

const app = buildApp();

const sampleReport = {
  generatedAt: "2026-03-27T00:00:00.000Z",
  propertyId: null,
  decisions: {
    totalApplications: 10,
    screening: { passed: 6, failed: 2, reviewRequired: 1, pending: 1 },
    approvals: { approved: 5, denied: 3, inProgress: 2 },
  },
  adverseActionCompleteness: {
    totalDenials: 3,
    noticesOnFile: 3,
    completenessPercent: 100,
    missingNotices: 0,
  },
  objectiveCriteria: ["Criminal background: auto-fail for felonies"],
  protectedClassNotice: "No protected class information collected.",
};

// ── GET /api/compliance/fair-housing ──────────────────────────────────────

describe("GET /api/compliance/fair-housing", () => {
  beforeEach(() => jest.resetAllMocks());

  it("returns 401 when no Authorization header is provided", async () => {
    const res = await request(app).get("/api/compliance/fair-housing");
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/authentication required/i);
  });

  it("returns 401 when token is invalid", async () => {
    const res = await request(app)
      .get("/api/compliance/fair-housing")
      .set("Authorization", "Bearer bad.token.here");
    expect(res.status).toBe(401);
  });

  it("returns 403 for leasing_agent (audit:view required)", async () => {
    mockAuthQuery(leasingAgent);
    const res = await request(app)
      .get("/api/compliance/fair-housing")
      .set("Authorization", tokenFor(leasingAgent));
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/insufficient permissions/i);
  });

  it("returns 403 for senior_manager (audit:view = regional_manager+)", async () => {
    mockAuthQuery(seniorManager);
    const res = await request(app)
      .get("/api/compliance/fair-housing")
      .set("Authorization", tokenFor(seniorManager));
    expect(res.status).toBe(403);
  });

  it("returns 200 with the full report for regional_manager", async () => {
    mockAuthQuery(regionalManager);
    mockGenerateReport.mockResolvedValue(sampleReport);
    const res = await request(app)
      .get("/api/compliance/fair-housing")
      .set("Authorization", tokenFor(regionalManager));
    expect(res.status).toBe(200);
    expect(res.body.decisions.totalApplications).toBe(10);
    expect(res.body.adverseActionCompleteness.completenessPercent).toBe(100);
    expect(Array.isArray(res.body.objectiveCriteria)).toBe(true);
  });

  it("calls generateReport(null) when no propertyId query param is provided", async () => {
    mockAuthQuery(regionalManager);
    mockGenerateReport.mockResolvedValue(sampleReport);
    await request(app)
      .get("/api/compliance/fair-housing")
      .set("Authorization", tokenFor(regionalManager));
    expect(mockGenerateReport).toHaveBeenCalledWith(null);
  });

  it("forwards propertyId query param to generateReport as a string", async () => {
    mockAuthQuery(regionalManager);
    mockGenerateReport.mockResolvedValue({ ...sampleReport, propertyId: "prop-001" });
    await request(app)
      .get("/api/compliance/fair-housing?propertyId=prop-001")
      .set("Authorization", tokenFor(regionalManager));
    expect(mockGenerateReport).toHaveBeenCalledWith("prop-001");
  });

  it("returns 500 when service throws", async () => {
    mockAuthQuery(regionalManager);
    mockGenerateReport.mockRejectedValue(new Error("DB connection lost"));
    const res = await request(app)
      .get("/api/compliance/fair-housing")
      .set("Authorization", tokenFor(regionalManager));
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to generate compliance report/i);
  });
});
