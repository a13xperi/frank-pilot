/**
 * Route-layer tests for src/modules/decision-matrix/routes.ts
 *
 * Tests HTTP contract: status codes, auth enforcement, RBAC, Zod validation,
 * service delegation, and error propagation across all three endpoints.
 *
 * Auth strategy: real JWT tokens + mock the users DB query that `authenticate`
 * runs on every request — exercises actual auth middleware.
 *
 * Service strategy: mock DecisionMatrixService at module level (instantiated
 * at route scope) — isolates routes from DB concerns covered in service tests.
 *
 * RBAC facts under test:
 *   modification:request → all roles (leasing_agent through system_admin)
 *   POST /decide/:id     → authenticate only — no requirePermission guard;
 *                          service enforces role-based logic internally
 *   lease:modify         → senior_manager, regional_manager, asset_manager, system_admin
 *
 * Zod schemas under test:
 *   modificationRequestSchema: modificationType enum + description (required) +
 *     optional originalValue/requestedValue
 *   modificationDecisionSchema: decision enum (approve|deny) + notes (required)
 */

import express from "express";
import request from "supertest";
import { generateToken, AuthUser } from "../middleware/auth";

// ── Mocks (must be declared before module imports) ─────────────────────────

jest.mock("../config/database", () => ({ query: jest.fn(), transaction: jest.fn() }));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockRequestModification = jest.fn();
const mockDecideModification = jest.fn();
const mockListModifications = jest.fn();

jest.mock("../modules/decision-matrix/service", () => ({
  DecisionMatrixService: jest.fn().mockImplementation(() => ({
    requestModification: mockRequestModification,
    decideModification: mockDecideModification,
    listModifications: mockListModifications,
  })),
}));

import { query } from "../config/database";
import decisionMatrixRouter from "../modules/decision-matrix/routes";

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
  app.use("/modifications", decisionMatrixRouter);
  return app;
}

const app = buildApp();

/** Minimal valid modification request body. */
function validRequestBody(overrides: Record<string, unknown> = {}) {
  return {
    modificationType: "rent_increase",
    description: "Requesting 5% annual rent adjustment.",
    ...overrides,
  };
}

// ── POST /:applicationId — request modification ───────────────────────────

describe("POST /modifications/:applicationId", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 when no Authorization header is provided", async () => {
    const res = await request(app)
      .post("/modifications/app-001")
      .send(validRequestBody());
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/authentication required/i);
  });

  it("returns 401 when token is invalid", async () => {
    const res = await request(app)
      .post("/modifications/app-001")
      .set("Authorization", "Bearer bad.token.here")
      .send(validRequestBody());
    expect(res.status).toBe(401);
  });

  it("returns 400 when modificationType is missing (Zod validation)", async () => {
    mockAuthQuery(leasingAgent);

    const res = await request(app)
      .post("/modifications/app-001")
      .set("Authorization", tokenFor(leasingAgent))
      .send({ description: "Some change" }); // missing modificationType

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/validation failed/i);
    expect(res.body.details).toBeDefined();
  });

  it("returns 400 when description is missing (Zod validation)", async () => {
    mockAuthQuery(leasingAgent);

    const res = await request(app)
      .post("/modifications/app-001")
      .set("Authorization", tokenFor(leasingAgent))
      .send({ modificationType: "rent_increase" }); // missing description

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/validation failed/i);
  });

  it("returns 400 when modificationType is not a valid enum value", async () => {
    mockAuthQuery(leasingAgent);

    const res = await request(app)
      .post("/modifications/app-001")
      .set("Authorization", tokenFor(leasingAgent))
      .send({ modificationType: "random_change", description: "Something." });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/validation failed/i);
  });

  it("accepts all valid modificationType enum values", async () => {
    const validTypes = [
      "rent_increase",
      "tenant_substitution",
      "lease_term_change",
      "pet_policy_change",
      "other",
    ];

    for (const modificationType of validTypes) {
      mockAuthQuery(leasingAgent);
      mockRequestModification.mockResolvedValue({ id: "mod-001", modificationType });

      const res = await request(app)
        .post("/modifications/app-001")
        .set("Authorization", tokenFor(leasingAgent))
        .send({ modificationType, description: "A change request." });

      expect(res.status).toBe(201);
    }
  });

  it("returns 201 with modification record when leasing_agent submits valid request", async () => {
    mockAuthQuery(leasingAgent);
    mockRequestModification.mockResolvedValue({ id: "mod-001", status: "pending" });

    const res = await request(app)
      .post("/modifications/app-001")
      .set("Authorization", tokenFor(leasingAgent))
      .send(validRequestBody());

    expect(res.status).toBe(201);
    expect(res.body.id).toBe("mod-001");
    expect(res.body.status).toBe("pending");
  });

  it("passes all args to service.requestModification including optional fields", async () => {
    mockAuthQuery(seniorManager);
    mockRequestModification.mockResolvedValue({ id: "mod-002" });

    await request(app)
      .post("/modifications/app-001")
      .set("Authorization", tokenFor(seniorManager))
      .send({
        modificationType: "rent_increase",
        description: "Annual 8% increase.",
        originalValue: "1200",
        requestedValue: "1296",
      });

    expect(mockRequestModification).toHaveBeenCalledWith({
      applicationId: "app-001",
      modificationType: "rent_increase",
      description: "Annual 8% increase.",
      originalValue: "1200",
      requestedValue: "1296",
      requestedBy: seniorManager.id,
      requestedByRole: seniorManager.role,
    });
  });

  it("omits optional fields when not provided", async () => {
    mockAuthQuery(leasingAgent);
    mockRequestModification.mockResolvedValue({ id: "mod-003" });

    await request(app)
      .post("/modifications/app-001")
      .set("Authorization", tokenFor(leasingAgent))
      .send(validRequestBody()); // no originalValue / requestedValue

    const callArg = mockRequestModification.mock.calls[0][0];
    expect(callArg.originalValue).toBeUndefined();
    expect(callArg.requestedValue).toBeUndefined();
  });

  it("returns 400 when service.requestModification throws", async () => {
    mockAuthQuery(leasingAgent);
    mockRequestModification.mockRejectedValue(new Error("Unknown modification type"));

    const res = await request(app)
      .post("/modifications/app-001")
      .set("Authorization", tokenFor(leasingAgent))
      .send(validRequestBody());

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unknown modification/i);
  });
});

// ── POST /decide/:modificationId — decide modification ────────────────────

describe("POST /modifications/decide/:modificationId", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 when no token provided", async () => {
    const res = await request(app)
      .post("/modifications/decide/mod-001")
      .send({ decision: "approve", notes: "Looks good." });
    expect(res.status).toBe(401);
  });

  it("returns 400 when decision is missing (Zod validation)", async () => {
    mockAuthQuery(seniorManager);

    const res = await request(app)
      .post("/modifications/decide/mod-001")
      .set("Authorization", tokenFor(seniorManager))
      .send({ notes: "Some notes" }); // missing decision

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/validation failed/i);
    expect(res.body.details).toBeDefined();
  });

  it("returns 400 when notes is missing (Zod validation)", async () => {
    mockAuthQuery(seniorManager);

    const res = await request(app)
      .post("/modifications/decide/mod-001")
      .set("Authorization", tokenFor(seniorManager))
      .send({ decision: "approve" }); // missing notes

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/validation failed/i);
  });

  it("returns 400 when decision is not approve or deny", async () => {
    mockAuthQuery(seniorManager);

    const res = await request(app)
      .post("/modifications/decide/mod-001")
      .set("Authorization", tokenFor(seniorManager))
      .send({ decision: "maybe", notes: "Not sure." });

    expect(res.status).toBe(400);
  });

  it("returns 200 when senior_manager approves a modification", async () => {
    mockAuthQuery(seniorManager);
    mockDecideModification.mockResolvedValue({ id: "mod-001", status: "approved" });

    const res = await request(app)
      .post("/modifications/decide/mod-001")
      .set("Authorization", tokenFor(seniorManager))
      .send({ decision: "approve", notes: "Rent increase justified by market rates." });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("approved");
  });

  it("returns 200 when regional_manager denies a modification", async () => {
    mockAuthQuery(regionalManager);
    mockDecideModification.mockResolvedValue({ id: "mod-001", status: "denied" });

    const res = await request(app)
      .post("/modifications/decide/mod-001")
      .set("Authorization", tokenFor(regionalManager))
      .send({ decision: "deny", notes: "Exceeds allowed increase." });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("denied");
  });

  it("allows leasing_agent to call the decide endpoint (no requirePermission guard)", async () => {
    // The decide route only uses authenticate — role enforcement is in the service.
    // A leasing_agent with insufficient role will get a 400 from service.decideModification.
    mockAuthQuery(leasingAgent);
    mockDecideModification.mockRejectedValue(new Error("Insufficient role to approve this modification"));

    const res = await request(app)
      .post("/modifications/decide/mod-001")
      .set("Authorization", tokenFor(leasingAgent))
      .send({ decision: "approve", notes: "Trying to approve." });

    // Route passes to service; service rejects — 400 not 403
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/insufficient role/i);
  });

  it("passes correct args to service.decideModification", async () => {
    mockAuthQuery(seniorManager);
    mockDecideModification.mockResolvedValue({ id: "mod-001", status: "approved" });

    await request(app)
      .post("/modifications/decide/mod-001")
      .set("Authorization", tokenFor(seniorManager))
      .send({ decision: "approve", notes: "All checks passed." });

    expect(mockDecideModification).toHaveBeenCalledWith({
      modificationId: "mod-001",
      decision: "approve",
      notes: "All checks passed.",
      decidedBy: seniorManager.id,
      decidedByRole: seniorManager.role,
    });
  });

  it("returns 400 when service.decideModification throws (already decided)", async () => {
    mockAuthQuery(seniorManager);
    mockDecideModification.mockRejectedValue(new Error("Modification already decided"));

    const res = await request(app)
      .post("/modifications/decide/mod-001")
      .set("Authorization", tokenFor(seniorManager))
      .send({ decision: "approve", notes: "Second attempt." });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already decided/i);
  });
});

// ── GET /:applicationId — list modifications ──────────────────────────────

describe("GET /modifications/:applicationId", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 when no token provided", async () => {
    const res = await request(app).get("/modifications/app-001");
    expect(res.status).toBe(401);
  });

  it("returns 403 when leasing_agent attempts to list modifications (lease:modify)", async () => {
    mockAuthQuery(leasingAgent);

    const res = await request(app)
      .get("/modifications/app-001")
      .set("Authorization", tokenFor(leasingAgent));

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/insufficient permissions/i);
  });

  it("returns 200 with empty modifications array when none exist", async () => {
    mockAuthQuery(seniorManager);
    mockListModifications.mockResolvedValue([]);

    const res = await request(app)
      .get("/modifications/app-001")
      .set("Authorization", tokenFor(seniorManager));

    expect(res.status).toBe(200);
    expect(res.body.modifications).toEqual([]);
  });

  it("returns 200 with modifications array when modifications exist", async () => {
    mockAuthQuery(seniorManager);
    mockListModifications.mockResolvedValue([
      { id: "mod-001", modificationType: "rent_increase", status: "pending" },
      { id: "mod-002", modificationType: "pet_policy_change", status: "approved" },
    ]);

    const res = await request(app)
      .get("/modifications/app-001")
      .set("Authorization", tokenFor(seniorManager));

    expect(res.status).toBe(200);
    expect(res.body.modifications).toHaveLength(2);
    expect(res.body.modifications[0].modificationType).toBe("rent_increase");
  });

  it("passes applicationId to service.listModifications", async () => {
    mockAuthQuery(seniorManager);
    mockListModifications.mockResolvedValue([]);

    await request(app)
      .get("/modifications/app-xyz")
      .set("Authorization", tokenFor(seniorManager));

    expect(mockListModifications).toHaveBeenCalledWith("app-xyz");
  });

  it("allows regional_manager to list modifications", async () => {
    mockAuthQuery(regionalManager);
    mockListModifications.mockResolvedValue([]);

    const res = await request(app)
      .get("/modifications/app-001")
      .set("Authorization", tokenFor(regionalManager));

    expect(res.status).toBe(200);
  });

  it("returns 500 when service.listModifications throws unexpectedly", async () => {
    mockAuthQuery(seniorManager);
    mockListModifications.mockRejectedValue(new Error("DB timeout"));

    const res = await request(app)
      .get("/modifications/app-001")
      .set("Authorization", tokenFor(seniorManager));

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to list modifications/i);
  });
});
