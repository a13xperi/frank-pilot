/**
 * Route-layer tests for src/modules/adverse-action/routes.ts
 *
 * Mounted at /api/applications in index.ts; routes are:
 *   GET  /:applicationId/adverse-action         — screening:view (senior_manager+)
 *   POST /:applicationId/adverse-action/resend  — approval:tier1 (senior_manager+)
 *
 * Auth strategy: real JWT tokens + mock the users DB query that `authenticate`
 * runs on every request — exercises actual auth middleware.
 *
 * Service strategy: mock AdverseActionService at module level — isolates routes
 * from DB/Twilio concerns already covered in adverse-action-service.test.ts.
 *
 * RBAC facts under test:
 *   screening:view  → senior_manager, regional_manager, asset_manager, system_admin
 *                     leasing_agent → 403
 *   approval:tier1  → senior_manager, regional_manager, asset_manager, system_admin
 *                     leasing_agent → 403
 *
 * FCRA note: the GET endpoint provides visibility into legally required notices;
 * the POST/resend allows manual re-issuance of FCRA notices (immutable audit trail).
 */

import express from "express";
import request from "supertest";
import { generateToken, AuthUser } from "../middleware/auth";

// ── Mocks (must be declared before module imports) ─────────────────────────

jest.mock("../config/database", () => ({ query: jest.fn(), transaction: jest.fn() }));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockGetNotice = jest.fn();
const mockSendNotice = jest.fn();

jest.mock("../modules/adverse-action/service", () => ({
  AdverseActionService: jest.fn().mockImplementation(() => ({
    getNotice: mockGetNotice,
    sendNotice: mockSendNotice,
  })),
}));

import { query } from "../config/database";
import adverseActionRouter from "../modules/adverse-action/routes";

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

const assetManager: AuthUser = {
  id: "user-am-001",
  email: "am@example.com",
  role: "asset_manager",
  firstName: "Carol",
  lastName: "Asset",
  propertyIds: [],
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
  // Mirror the index.ts mount point
  app.use("/api/applications", adverseActionRouter);
  return app;
}

const app = buildApp();

const APP_ID = "app-001";

// ── GET /:applicationId/adverse-action ────────────────────────────────────

describe("GET /api/applications/:applicationId/adverse-action", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 when no Authorization header is provided", async () => {
    const res = await request(app).get(`/api/applications/${APP_ID}/adverse-action`);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/authentication required/i);
  });

  it("returns 401 when token is invalid", async () => {
    const res = await request(app)
      .get(`/api/applications/${APP_ID}/adverse-action`)
      .set("Authorization", "Bearer bad.token.here");
    expect(res.status).toBe(401);
  });

  it("returns 403 when leasing_agent attempts to view (screening:view)", async () => {
    mockAuthQuery(leasingAgent);
    const res = await request(app)
      .get(`/api/applications/${APP_ID}/adverse-action`)
      .set("Authorization", tokenFor(leasingAgent));
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/insufficient permissions/i);
  });

  it("returns 200 with notice when found (senior_manager)", async () => {
    const sampleNotice = {
      noticeId: "notice-001",
      applicationId: APP_ID,
      sentAt: "2026-01-15T10:00:00Z",
      reason: "screening_failed",
      reasonDetail: null,
    };
    mockAuthQuery(seniorManager);
    mockGetNotice.mockResolvedValue(sampleNotice);
    const res = await request(app)
      .get(`/api/applications/${APP_ID}/adverse-action`)
      .set("Authorization", tokenFor(seniorManager));
    expect(res.status).toBe(200);
    expect(res.body.noticeId).toBe("notice-001");
    expect(res.body.reason).toBe("screening_failed");
  });

  it("returns 404 when no notice exists for this application", async () => {
    mockAuthQuery(seniorManager);
    mockGetNotice.mockResolvedValue(null);
    const res = await request(app)
      .get(`/api/applications/${APP_ID}/adverse-action`)
      .set("Authorization", tokenFor(seniorManager));
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/no adverse action notice found/i);
  });

  it("forwards applicationId to service.getNotice", async () => {
    mockAuthQuery(assetManager);
    mockGetNotice.mockResolvedValue({ noticeId: "n1" });
    await request(app)
      .get(`/api/applications/${APP_ID}/adverse-action`)
      .set("Authorization", tokenFor(assetManager));
    expect(mockGetNotice).toHaveBeenCalledWith(APP_ID);
  });

  it("returns 500 when service throws", async () => {
    mockAuthQuery(seniorManager);
    mockGetNotice.mockRejectedValue(new Error("DB timeout"));
    const res = await request(app)
      .get(`/api/applications/${APP_ID}/adverse-action`)
      .set("Authorization", tokenFor(seniorManager));
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to retrieve adverse action notice/i);
  });
});

// ── POST /:applicationId/adverse-action/resend ────────────────────────────

describe("POST /api/applications/:applicationId/adverse-action/resend", () => {
  const resendUrl = `/api/applications/${APP_ID}/adverse-action/resend`;

  beforeEach(() => jest.clearAllMocks());

  it("returns 401 when no Authorization header is provided", async () => {
    const res = await request(app).post(resendUrl).send({});
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/authentication required/i);
  });

  it("returns 401 when token is invalid", async () => {
    const res = await request(app)
      .post(resendUrl)
      .set("Authorization", "Bearer bad.token.here")
      .send({});
    expect(res.status).toBe(401);
  });

  it("returns 403 when leasing_agent attempts to resend (approval:tier1)", async () => {
    mockAuthQuery(leasingAgent);
    const res = await request(app)
      .post(resendUrl)
      .set("Authorization", tokenFor(leasingAgent))
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/insufficient permissions/i);
  });

  it("returns 200 with notice result on success (senior_manager)", async () => {
    const result = {
      noticeId: "notice-002",
      applicationId: APP_ID,
      sentAt: "2026-03-27T10:00:00Z",
      reason: "manual_resend",
    };
    mockAuthQuery(seniorManager);
    mockSendNotice.mockResolvedValue(result);
    const res = await request(app)
      .post(resendUrl)
      .set("Authorization", tokenFor(seniorManager))
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.noticeId).toBe("notice-002");
    expect(res.body.reason).toBe("manual_resend");
  });

  it("defaults reason to 'manual_resend' when not provided in body", async () => {
    mockAuthQuery(seniorManager);
    mockSendNotice.mockResolvedValue({ noticeId: "n2" });
    await request(app)
      .post(resendUrl)
      .set("Authorization", tokenFor(seniorManager))
      .send({});
    expect(mockSendNotice).toHaveBeenCalledWith(
      APP_ID,
      seniorManager.id,
      seniorManager.role,
      "manual_resend",
      undefined
    );
  });

  it("forwards custom reason and reasonDetail when provided", async () => {
    mockAuthQuery(assetManager);
    mockSendNotice.mockResolvedValue({ noticeId: "n3" });
    await request(app)
      .post(resendUrl)
      .set("Authorization", tokenFor(assetManager))
      .send({ reason: "tier1_denied", reasonDetail: "Income too high for AMI limits" });
    expect(mockSendNotice).toHaveBeenCalledWith(
      APP_ID,
      assetManager.id,
      assetManager.role,
      "tier1_denied",
      "Income too high for AMI limits"
    );
  });

  it("forwards applicationId, actorId, and actorRole to service.sendNotice", async () => {
    mockAuthQuery(seniorManager);
    mockSendNotice.mockResolvedValue({ noticeId: "n4" });
    await request(app)
      .post(resendUrl)
      .set("Authorization", tokenFor(seniorManager))
      .send({ reason: "screening_failed" });
    expect(mockSendNotice).toHaveBeenCalledWith(
      APP_ID,
      seniorManager.id,
      seniorManager.role,
      "screening_failed",
      undefined
    );
  });

  it("returns 400 when service throws (e.g. application not found)", async () => {
    mockAuthQuery(seniorManager);
    mockSendNotice.mockRejectedValue(new Error("Application not found: app-999"));
    const res = await request(app)
      .post(`/api/applications/app-999/adverse-action/resend`)
      .set("Authorization", tokenFor(seniorManager))
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/application not found/i);
  });
});
