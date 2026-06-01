/**
 * Route-layer tests for src/modules/screening/routes.ts
 *
 * Tests HTTP contract: status codes, auth enforcement, RBAC, service
 * delegation, and error propagation across all four endpoints.
 *
 * Auth strategy: real JWT tokens + mock the users DB query that `authenticate`
 * runs on every request — exercises actual auth middleware.
 *
 * Service strategy: mock ScreeningService and FraudDetectionService at module
 * level (both instantiated at route scope) — isolates routes from DB / crypto.
 *
 * RBAC facts under test:
 *   screening:initiate → senior_manager, regional_manager, asset_manager, system_admin
 *   screening:view     → senior_manager, regional_manager, asset_manager, system_admin
 *   fraud:view         → senior_manager, regional_manager, asset_manager, system_admin
 *   fraud:resolve      → regional_manager, asset_manager, system_admin
 */

import express from "express";
import request from "supertest";
import { generateToken, AuthUser } from "../middleware/auth";

// ── Mocks (must be declared before module imports) ─────────────────────────

jest.mock("../config/database", () => ({ query: jest.fn(), transaction: jest.fn() }));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockRunFullScreening = jest.fn();
const mockGetResults = jest.fn();
const mockGetAdverseActionDraft = jest.fn();

jest.mock("../modules/screening/service", () => ({
  ScreeningService: jest.fn().mockImplementation(() => ({
    runFullScreening: mockRunFullScreening,
    getResults: mockGetResults,
    getAdverseActionDraft: mockGetAdverseActionDraft,
  })),
}));

const mockGetUnresolvedFlags = jest.fn();
const mockResolveFlag = jest.fn();

jest.mock("../modules/screening/fraud-detection", () => ({
  FraudDetectionService: jest.fn().mockImplementation(() => ({
    checkDuplicateSSN: jest.fn().mockResolvedValue({ isDuplicate: false, existingApplicationIds: [] }),
    getUnresolvedFlags: mockGetUnresolvedFlags,
    resolveFlag: mockResolveFlag,
  })),
}));

import { query } from "../config/database";
import screeningRouter from "../modules/screening/routes";

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
  app.use("/screening", screeningRouter);
  return app;
}

const app = buildApp();

// ── POST /:applicationId/screen — initiate screening ─────────────────────

describe("POST /screening/:applicationId/screen", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 when no Authorization header is provided", async () => {
    const res = await request(app).post("/screening/app-001/screen");
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/authentication required/i);
  });

  it("returns 401 when token is invalid", async () => {
    const res = await request(app)
      .post("/screening/app-001/screen")
      .set("Authorization", "Bearer bad.token.here");
    expect(res.status).toBe(401);
  });

  it("returns 403 when leasing_agent attempts to initiate screening", async () => {
    mockAuthQuery(leasingAgent);

    const res = await request(app)
      .post("/screening/app-001/screen")
      .set("Authorization", tokenFor(leasingAgent));

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/insufficient permissions/i);
  });

  it("returns 200 with screening result when senior_manager initiates screening", async () => {
    mockAuthQuery(seniorManager);
    mockRunFullScreening.mockResolvedValue({
      overallResult: "pass",
      applicationId: "app-001",
    });

    const res = await request(app)
      .post("/screening/app-001/screen")
      .set("Authorization", tokenFor(seniorManager));

    expect(res.status).toBe(200);
    expect(res.body.overallResult).toBe("pass");
    expect(res.body.applicationId).toBe("app-001");
  });

  it("passes applicationId, userId, userRole, and optional screeningTag to service.runFullScreening", async () => {
    mockAuthQuery(seniorManager);
    mockRunFullScreening.mockResolvedValue({ overallResult: "pass" });

    await request(app)
      .post("/screening/app-001/screen")
      .set("Authorization", tokenFor(seniorManager));

    // 4th arg is the optional MOCK_MODE screeningTag knob; omitted in this request.
    expect(mockRunFullScreening).toHaveBeenCalledWith(
      "app-001",
      seniorManager.id,
      seniorManager.role,
      undefined
    );
  });

  it("threads screeningTag from POST body into runFullScreening", async () => {
    mockAuthQuery(seniorManager);
    mockRunFullScreening.mockResolvedValue({ overallResult: "fail" });

    await request(app)
      .post("/screening/app-001/screen")
      .set("Authorization", tokenFor(seniorManager))
      .send({ screeningTag: "id_verification_fail" });

    expect(mockRunFullScreening).toHaveBeenCalledWith(
      "app-001",
      seniorManager.id,
      seniorManager.role,
      "id_verification_fail"
    );
  });

  it("returns 400 when service.runFullScreening throws (e.g. application not submitted)", async () => {
    mockAuthQuery(seniorManager);
    mockRunFullScreening.mockRejectedValue(new Error("Application not in submitted status"));

    const res = await request(app)
      .post("/screening/app-001/screen")
      .set("Authorization", tokenFor(seniorManager));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not in submitted/i);
  });

  it("allows regional_manager to initiate screening", async () => {
    mockAuthQuery(regionalManager);
    mockRunFullScreening.mockResolvedValue({ overallResult: "review_required" });

    const res = await request(app)
      .post("/screening/app-001/screen")
      .set("Authorization", tokenFor(regionalManager));

    expect(res.status).toBe(200);
  });
});

// ── GET /:applicationId/results — get screening results ───────────────────

describe("GET /screening/:applicationId/results", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 when no token provided", async () => {
    const res = await request(app).get("/screening/app-001/results");
    expect(res.status).toBe(401);
  });

  it("returns 403 when leasing_agent attempts to view screening results", async () => {
    mockAuthQuery(leasingAgent);

    const res = await request(app)
      .get("/screening/app-001/results")
      .set("Authorization", tokenFor(leasingAgent));

    expect(res.status).toBe(403);
  });

  it("returns 404 when no screening results exist", async () => {
    mockAuthQuery(seniorManager);
    mockGetResults.mockResolvedValue(null);

    const res = await request(app)
      .get("/screening/app-001/results")
      .set("Authorization", tokenFor(seniorManager));

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("returns 200 with screening results when found", async () => {
    mockAuthQuery(seniorManager);
    mockGetResults.mockResolvedValue({
      applicationId: "app-001",
      overallResult: "pass",
      creditScore: 720,
    });

    const res = await request(app)
      .get("/screening/app-001/results")
      .set("Authorization", tokenFor(seniorManager));

    expect(res.status).toBe(200);
    expect(res.body.overallResult).toBe("pass");
    expect(res.body.creditScore).toBe(720);
  });

  it("passes applicationId to service.getResults", async () => {
    mockAuthQuery(seniorManager);
    mockGetResults.mockResolvedValue({ applicationId: "app-xyz" });

    await request(app)
      .get("/screening/app-xyz/results")
      .set("Authorization", tokenFor(seniorManager));

    expect(mockGetResults).toHaveBeenCalledWith("app-xyz");
  });

  it("returns 500 when service.getResults throws unexpectedly", async () => {
    mockAuthQuery(seniorManager);
    mockGetResults.mockRejectedValue(new Error("DB connection lost"));

    const res = await request(app)
      .get("/screening/app-001/results")
      .set("Authorization", tokenFor(seniorManager));

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to get screening results/i);
  });
});

// ── GET /:applicationId/fraud-flags — get fraud flags ────────────────────

describe("GET /screening/:applicationId/fraud-flags", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 when no token provided", async () => {
    const res = await request(app).get("/screening/app-001/fraud-flags");
    expect(res.status).toBe(401);
  });

  it("returns 403 when leasing_agent attempts to view fraud flags", async () => {
    mockAuthQuery(leasingAgent);

    const res = await request(app)
      .get("/screening/app-001/fraud-flags")
      .set("Authorization", tokenFor(leasingAgent));

    expect(res.status).toBe(403);
  });

  it("returns 200 with empty flags array when no flags exist", async () => {
    mockAuthQuery(seniorManager);
    mockGetUnresolvedFlags.mockResolvedValue([]);

    const res = await request(app)
      .get("/screening/app-001/fraud-flags")
      .set("Authorization", tokenFor(seniorManager));

    expect(res.status).toBe(200);
    expect(res.body.flags).toEqual([]);
  });

  it("returns 200 with fraud flags array when flags exist", async () => {
    mockAuthQuery(seniorManager);
    mockGetUnresolvedFlags.mockResolvedValue([
      { id: "flag-001", flagType: "income_mismatch", severity: "high" },
      { id: "flag-002", flagType: "duplicate_ssn", severity: "high" },
    ]);

    const res = await request(app)
      .get("/screening/app-001/fraud-flags")
      .set("Authorization", tokenFor(seniorManager));

    expect(res.status).toBe(200);
    expect(res.body.flags).toHaveLength(2);
    expect(res.body.flags[0].flagType).toBe("income_mismatch");
  });

  it("passes applicationId to fraudService.getUnresolvedFlags", async () => {
    mockAuthQuery(seniorManager);
    mockGetUnresolvedFlags.mockResolvedValue([]);

    await request(app)
      .get("/screening/app-xyz/fraud-flags")
      .set("Authorization", tokenFor(seniorManager));

    expect(mockGetUnresolvedFlags).toHaveBeenCalledWith("app-xyz");
  });

  it("returns 500 when fraudService.getUnresolvedFlags throws", async () => {
    mockAuthQuery(seniorManager);
    mockGetUnresolvedFlags.mockRejectedValue(new Error("DB error"));

    const res = await request(app)
      .get("/screening/app-001/fraud-flags")
      .set("Authorization", tokenFor(seniorManager));

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to get fraud flags/i);
  });
});

// ── POST /fraud-flags/:flagId/resolve — resolve fraud flag ────────────────

describe("POST /screening/fraud-flags/:flagId/resolve", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 when no token provided", async () => {
    const res = await request(app)
      .post("/screening/fraud-flags/flag-001/resolve")
      .send({ notes: "Verified with applicant." });
    expect(res.status).toBe(401);
  });

  it("returns 403 when leasing_agent attempts to resolve fraud flag", async () => {
    mockAuthQuery(leasingAgent);

    const res = await request(app)
      .post("/screening/fraud-flags/flag-001/resolve")
      .set("Authorization", tokenFor(leasingAgent))
      .send({ notes: "Verified." });

    expect(res.status).toBe(403);
  });

  it("returns 403 when senior_manager attempts to resolve fraud flag (fraud:resolve requires regional_manager+)", async () => {
    mockAuthQuery(seniorManager);

    const res = await request(app)
      .post("/screening/fraud-flags/flag-001/resolve")
      .set("Authorization", tokenFor(seniorManager))
      .send({ notes: "Verified." });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/insufficient permissions/i);
  });

  it("returns 400 when notes are missing from request body", async () => {
    mockAuthQuery(regionalManager);

    const res = await request(app)
      .post("/screening/fraud-flags/flag-001/resolve")
      .set("Authorization", tokenFor(regionalManager))
      .send({}); // no notes

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/resolution notes are required/i);
  });

  it("returns 200 with result when regional_manager resolves flag with notes", async () => {
    mockAuthQuery(regionalManager);
    mockResolveFlag.mockResolvedValue({ id: "flag-001", resolved: true });

    const res = await request(app)
      .post("/screening/fraud-flags/flag-001/resolve")
      .set("Authorization", tokenFor(regionalManager))
      .send({ notes: "Verified income documentation directly with employer." });

    expect(res.status).toBe(200);
    expect(res.body.resolved).toBe(true);
  });

  it("passes flagId, userId, and notes to fraudService.resolveFlag", async () => {
    mockAuthQuery(regionalManager);
    mockResolveFlag.mockResolvedValue({ id: "flag-001", resolved: true });

    await request(app)
      .post("/screening/fraud-flags/flag-001/resolve")
      .set("Authorization", tokenFor(regionalManager))
      .send({ notes: "Verified with paycheck stubs." });

    expect(mockResolveFlag).toHaveBeenCalledWith(
      "flag-001",
      regionalManager.id,
      "Verified with paycheck stubs."
    );
  });

  it("returns 500 when fraudService.resolveFlag throws", async () => {
    mockAuthQuery(regionalManager);
    mockResolveFlag.mockRejectedValue(new Error("Flag not found"));

    const res = await request(app)
      .post("/screening/fraud-flags/flag-001/resolve")
      .set("Authorization", tokenFor(regionalManager))
      .send({ notes: "Verified." });

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to resolve fraud flag/i);
  });
});

// ── GET /:applicationId/adverse-action/draft — preview FCRA denial notice ──
//
// Render-only preview, gated by screening:initiate (only staff who can deny may
// preview the denial). reasonDetail is an optional query param coerced to a
// string (array/duplicate params collapse to undefined).

describe("GET /screening/:applicationId/adverse-action/draft", () => {
  beforeEach(() => jest.clearAllMocks());

  const sampleDraft = {
    applicationId: "app-001",
    applicantName: "Jane Doe",
    propertyName: "Desert Oasis Apartments",
    noticeText: "Dear Jane Doe, ... FCRA § 1681m ...",
  };

  it("returns 401 when no token provided", async () => {
    const res = await request(app).get("/screening/app-001/adverse-action/draft");
    expect(res.status).toBe(401);
  });

  it("returns 403 when leasing_agent attempts to preview a denial notice", async () => {
    mockAuthQuery(leasingAgent);

    const res = await request(app)
      .get("/screening/app-001/adverse-action/draft")
      .set("Authorization", tokenFor(leasingAgent));

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/insufficient permissions/i);
  });

  it("returns 200 with the rendered draft when senior_manager previews", async () => {
    mockAuthQuery(seniorManager);
    mockGetAdverseActionDraft.mockResolvedValue(sampleDraft);

    const res = await request(app)
      .get("/screening/app-001/adverse-action/draft?reasonDetail=Criminal%20history")
      .set("Authorization", tokenFor(seniorManager));

    expect(res.status).toBe(200);
    expect(res.body.draft).toEqual(sampleDraft);
    expect(mockGetAdverseActionDraft).toHaveBeenCalledWith("app-001", "Criminal history");
  });

  it("coerces a duplicated reasonDetail query param to undefined (no array reaches the service)", async () => {
    mockAuthQuery(seniorManager);
    mockGetAdverseActionDraft.mockResolvedValue(sampleDraft);

    await request(app)
      .get("/screening/app-001/adverse-action/draft?reasonDetail=a&reasonDetail=b")
      .set("Authorization", tokenFor(seniorManager));

    expect(mockGetAdverseActionDraft).toHaveBeenCalledWith("app-001", undefined);
  });

  it("returns 400 when the service throws (e.g. application not found)", async () => {
    mockAuthQuery(seniorManager);
    mockGetAdverseActionDraft.mockRejectedValue(new Error("Application not found: app-001"));

    const res = await request(app)
      .get("/screening/app-001/adverse-action/draft")
      .set("Authorization", tokenFor(seniorManager));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/application not found/i);
  });
});
