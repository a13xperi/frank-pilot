/**
 * Route-layer tests for src/modules/users/routes.ts
 *
 * Tests HTTP contract: status codes, auth enforcement, RBAC, Zod validation,
 * service delegation, and error propagation across all six endpoints.
 *
 * Auth strategy: real JWT tokens + mock the users DB query that `authenticate`
 * runs on every request — exercises actual auth middleware.
 *
 * Service strategy: mock UserService at module level (instantiated at route
 * scope) — isolates routes from DB/bcrypt concerns covered in service tests.
 *
 * RBAC facts under test:
 *   user:view   → senior_manager, regional_manager, asset_manager, system_admin
 *                 leasing_agent → 403
 *   user:manage → system_admin only
 *                 everyone else (including asset_manager) → 403
 */

import express from "express";
import request from "supertest";
import { generateToken, AuthUser } from "../middleware/auth";

// ── Mocks (must be declared before module imports) ─────────────────────────

jest.mock("../config/database", () => ({ query: jest.fn(), transaction: jest.fn() }));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("bcrypt", () => ({ hash: jest.fn(), compare: jest.fn() }));

const mockList = jest.fn();
const mockGetById = jest.fn();
const mockCreate = jest.fn();
const mockSetActive = jest.fn();
const mockResetPassword = jest.fn();
const mockSignupStats = jest.fn();

jest.mock("../modules/users/service", () => ({
  UserService: jest.fn().mockImplementation(() => ({
    list: mockList,
    getById: mockGetById,
    create: mockCreate,
    setActive: mockSetActive,
    resetPassword: mockResetPassword,
    signupStats: mockSignupStats,
  })),
}));

import { query } from "../config/database";
import userRouter from "../modules/users/routes";

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

const assetManager: AuthUser = {
  id: "user-am-001",
  email: "am@example.com",
  role: "asset_manager",
  firstName: "Carol",
  lastName: "Asset",
  propertyIds: [],
  emailVerified: true,
};

const systemAdmin: AuthUser = {
  id: "user-sa-001",
  email: "admin@example.com",
  role: "system_admin",
  firstName: "Dave",
  lastName: "Admin",
  propertyIds: [],
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
  app.use("/users", userRouter);
  return app;
}

const app = buildApp();

// ── GET /users — list users ────────────────────────────────────────────────

describe("GET /users", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 without auth", async () => {
    const res = await request(app).get("/users");
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/authentication required/i);
  });

  it("returns 403 when leasing_agent attempts to list users (user:view)", async () => {
    mockAuthQuery(leasingAgent);
    const res = await request(app)
      .get("/users")
      .set("Authorization", tokenFor(leasingAgent));
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/insufficient permissions/i);
  });

  it("returns 200 with users array for senior_manager", async () => {
    mockAuthQuery(seniorManager);
    mockList.mockResolvedValue([{ id: "u1", email: "x@x.com" }]);
    const res = await request(app)
      .get("/users")
      .set("Authorization", tokenFor(seniorManager));
    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(1);
    expect(res.body.total).toBe(1);
  });

  it("forwards role query param as filter", async () => {
    mockAuthQuery(seniorManager);
    mockList.mockResolvedValue([]);
    await request(app)
      .get("/users?role=leasing_agent")
      .set("Authorization", tokenFor(seniorManager));
    expect(mockList).toHaveBeenCalledWith(
      expect.objectContaining({ role: "leasing_agent" })
    );
  });

  it("forwards isActive=true as boolean filter", async () => {
    mockAuthQuery(seniorManager);
    mockList.mockResolvedValue([]);
    await request(app)
      .get("/users?isActive=true")
      .set("Authorization", tokenFor(seniorManager));
    expect(mockList).toHaveBeenCalledWith(
      expect.objectContaining({ isActive: true })
    );
  });

  it("forwards isActive=false as boolean filter", async () => {
    mockAuthQuery(seniorManager);
    mockList.mockResolvedValue([]);
    await request(app)
      .get("/users?isActive=false")
      .set("Authorization", tokenFor(seniorManager));
    expect(mockList).toHaveBeenCalledWith(
      expect.objectContaining({ isActive: false })
    );
  });

  it("returns 500 when service throws", async () => {
    mockAuthQuery(seniorManager);
    mockList.mockRejectedValue(new Error("DB error"));
    const res = await request(app)
      .get("/users")
      .set("Authorization", tokenFor(seniorManager));
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to list users/i);
  });
});

// ── GET /users/signup-stats — funnel signup counts ─────────────────────────

describe("GET /users/signup-stats", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 without auth", async () => {
    const res = await request(app).get("/users/signup-stats");
    expect(res.status).toBe(401);
  });

  it("returns 403 for leasing_agent (user:view)", async () => {
    mockAuthQuery(leasingAgent);
    const res = await request(app)
      .get("/users/signup-stats")
      .set("Authorization", tokenFor(leasingAgent));
    expect(res.status).toBe(403);
  });

  it("returns 200 with registered/verified counts for senior_manager", async () => {
    mockAuthQuery(seniorManager);
    mockSignupStats.mockResolvedValue({ registered: 42, verified: 30 });
    const res = await request(app)
      .get("/users/signup-stats")
      .set("Authorization", tokenFor(seniorManager));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ registered: 42, verified: 30 });
  });

  it("is not shadowed by GET /:userId (hits signupStats, not getById)", async () => {
    mockAuthQuery(seniorManager);
    mockSignupStats.mockResolvedValue({ registered: 1, verified: 1 });
    await request(app)
      .get("/users/signup-stats")
      .set("Authorization", tokenFor(seniorManager));
    expect(mockSignupStats).toHaveBeenCalled();
    expect(mockGetById).not.toHaveBeenCalled();
  });

  it("returns 500 when service throws", async () => {
    mockAuthQuery(seniorManager);
    mockSignupStats.mockRejectedValue(new Error("DB error"));
    const res = await request(app)
      .get("/users/signup-stats")
      .set("Authorization", tokenFor(seniorManager));
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to load signup stats/i);
  });
});

// ── GET /users/:userId — get one user ─────────────────────────────────────

describe("GET /users/:userId", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 without auth", async () => {
    const res = await request(app).get("/users/user-001");
    expect(res.status).toBe(401);
  });

  it("returns 403 for leasing_agent", async () => {
    mockAuthQuery(leasingAgent);
    const res = await request(app)
      .get("/users/user-001")
      .set("Authorization", tokenFor(leasingAgent));
    expect(res.status).toBe(403);
  });

  it("returns 200 with user when found", async () => {
    const sampleUser = { id: "user-001", email: "test@example.com", role: "leasing_agent" };
    mockAuthQuery(seniorManager);
    mockGetById.mockResolvedValue(sampleUser);
    const res = await request(app)
      .get("/users/user-001")
      .set("Authorization", tokenFor(seniorManager));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("user-001");
  });

  it("returns 404 when user not found", async () => {
    mockAuthQuery(seniorManager);
    mockGetById.mockResolvedValue(null);
    const res = await request(app)
      .get("/users/nonexistent")
      .set("Authorization", tokenFor(seniorManager));
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/user not found/i);
  });

  it("forwards userId to service.getById", async () => {
    mockAuthQuery(assetManager);
    mockGetById.mockResolvedValue({ id: "user-abc" });
    await request(app)
      .get("/users/user-abc")
      .set("Authorization", tokenFor(assetManager));
    expect(mockGetById).toHaveBeenCalledWith("user-abc");
  });
});

// ── POST /users — create user ──────────────────────────────────────────────

describe("POST /users", () => {
  const validPayload = {
    email: "new@example.com",
    password: "securepass123",
    firstName: "Jane",
    lastName: "Doe",
    role: "leasing_agent",
  };

  beforeEach(() => jest.clearAllMocks());

  it("returns 401 without auth", async () => {
    const res = await request(app).post("/users").send(validPayload);
    expect(res.status).toBe(401);
  });

  it("returns 403 for senior_manager (user:manage = system_admin only)", async () => {
    mockAuthQuery(seniorManager);
    const res = await request(app)
      .post("/users")
      .set("Authorization", tokenFor(seniorManager))
      .send(validPayload);
    expect(res.status).toBe(403);
  });

  it("returns 403 for asset_manager (user:manage = system_admin only)", async () => {
    mockAuthQuery(assetManager);
    const res = await request(app)
      .post("/users")
      .set("Authorization", tokenFor(assetManager))
      .send(validPayload);
    expect(res.status).toBe(403);
  });

  it("returns 400 when required fields are missing", async () => {
    mockAuthQuery(systemAdmin);
    const res = await request(app)
      .post("/users")
      .set("Authorization", tokenFor(systemAdmin))
      .send({ email: "missing@example.com" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/validation failed/i);
  });

  it("returns 400 when password is shorter than 8 characters", async () => {
    mockAuthQuery(systemAdmin);
    const res = await request(app)
      .post("/users")
      .set("Authorization", tokenFor(systemAdmin))
      .send({ ...validPayload, password: "short" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/validation failed/i);
  });

  it("returns 400 when email is invalid", async () => {
    mockAuthQuery(systemAdmin);
    const res = await request(app)
      .post("/users")
      .set("Authorization", tokenFor(systemAdmin))
      .send({ ...validPayload, email: "not-an-email" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when role is not a valid enum value", async () => {
    mockAuthQuery(systemAdmin);
    const res = await request(app)
      .post("/users")
      .set("Authorization", tokenFor(systemAdmin))
      .send({ ...validPayload, role: "super_hacker" });
    expect(res.status).toBe(400);
  });

  it("returns 201 with created user on success", async () => {
    const created = { id: "user-new", email: "new@example.com", role: "leasing_agent" };
    mockAuthQuery(systemAdmin);
    mockCreate.mockResolvedValue(created);
    const res = await request(app)
      .post("/users")
      .set("Authorization", tokenFor(systemAdmin))
      .send(validPayload);
    expect(res.status).toBe(201);
    expect(res.body.id).toBe("user-new");
  });

  it("forwards actorId and actorRole to service.create", async () => {
    mockAuthQuery(systemAdmin);
    mockCreate.mockResolvedValue({ id: "user-new" });
    await request(app)
      .post("/users")
      .set("Authorization", tokenFor(systemAdmin))
      .send(validPayload);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ email: "new@example.com" }),
      systemAdmin.id,
      systemAdmin.role
    );
  });

  it("returns 400 when service throws (e.g. duplicate email)", async () => {
    mockAuthQuery(systemAdmin);
    mockCreate.mockRejectedValue(new Error("duplicate key value: email"));
    const res = await request(app)
      .post("/users")
      .set("Authorization", tokenFor(systemAdmin))
      .send(validPayload);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/duplicate key/i);
  });
});

// ── PATCH /users/:userId/deactivate ───────────────────────────────────────

describe("PATCH /users/:userId/deactivate", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 without auth", async () => {
    const res = await request(app).patch("/users/user-001/deactivate");
    expect(res.status).toBe(401);
  });

  it("returns 403 for asset_manager (user:manage = system_admin only)", async () => {
    mockAuthQuery(assetManager);
    const res = await request(app)
      .patch("/users/user-001/deactivate")
      .set("Authorization", tokenFor(assetManager));
    expect(res.status).toBe(403);
  });

  it("returns 200 with deactivated user on success", async () => {
    const deactivated = { id: "user-001", isActive: false };
    mockAuthQuery(systemAdmin);
    mockSetActive.mockResolvedValue(deactivated);
    const res = await request(app)
      .patch("/users/user-001/deactivate")
      .set("Authorization", tokenFor(systemAdmin));
    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(false);
  });

  it("calls service.setActive with isActive=false", async () => {
    mockAuthQuery(systemAdmin);
    mockSetActive.mockResolvedValue({ id: "user-001" });
    await request(app)
      .patch("/users/user-001/deactivate")
      .set("Authorization", tokenFor(systemAdmin));
    expect(mockSetActive).toHaveBeenCalledWith("user-001", false, systemAdmin.id, systemAdmin.role);
  });

  it("returns 400 when user not found", async () => {
    mockAuthQuery(systemAdmin);
    mockSetActive.mockRejectedValue(new Error("User not found: user-999"));
    const res = await request(app)
      .patch("/users/user-999/deactivate")
      .set("Authorization", tokenFor(systemAdmin));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/user not found/i);
  });
});

// ── PATCH /users/:userId/activate ─────────────────────────────────────────

describe("PATCH /users/:userId/activate", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 without auth", async () => {
    const res = await request(app).patch("/users/user-001/activate");
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-system_admin", async () => {
    mockAuthQuery(seniorManager);
    const res = await request(app)
      .patch("/users/user-001/activate")
      .set("Authorization", tokenFor(seniorManager));
    expect(res.status).toBe(403);
  });

  it("returns 200 with activated user on success", async () => {
    const activated = { id: "user-001", isActive: true };
    mockAuthQuery(systemAdmin);
    mockSetActive.mockResolvedValue(activated);
    const res = await request(app)
      .patch("/users/user-001/activate")
      .set("Authorization", tokenFor(systemAdmin));
    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(true);
  });

  it("calls service.setActive with isActive=true", async () => {
    mockAuthQuery(systemAdmin);
    mockSetActive.mockResolvedValue({ id: "user-001" });
    await request(app)
      .patch("/users/user-001/activate")
      .set("Authorization", tokenFor(systemAdmin));
    expect(mockSetActive).toHaveBeenCalledWith("user-001", true, systemAdmin.id, systemAdmin.role);
  });
});

// ── POST /users/:userId/reset-password ────────────────────────────────────

describe("POST /users/:userId/reset-password", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 without auth", async () => {
    const res = await request(app)
      .post("/users/user-001/reset-password")
      .send({ newPassword: "newpassword1" });
    expect(res.status).toBe(401);
  });

  it("returns 403 for asset_manager (user:manage = system_admin only)", async () => {
    mockAuthQuery(assetManager);
    const res = await request(app)
      .post("/users/user-001/reset-password")
      .set("Authorization", tokenFor(assetManager))
      .send({ newPassword: "newpassword1" });
    expect(res.status).toBe(403);
  });

  it("returns 400 when newPassword is shorter than 8 characters", async () => {
    mockAuthQuery(systemAdmin);
    const res = await request(app)
      .post("/users/user-001/reset-password")
      .set("Authorization", tokenFor(systemAdmin))
      .send({ newPassword: "short" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/validation failed/i);
  });

  it("returns 400 when newPassword is missing", async () => {
    mockAuthQuery(systemAdmin);
    const res = await request(app)
      .post("/users/user-001/reset-password")
      .set("Authorization", tokenFor(systemAdmin))
      .send({});
    expect(res.status).toBe(400);
  });

  it("returns 200 with success message on success", async () => {
    mockAuthQuery(systemAdmin);
    mockResetPassword.mockResolvedValue(undefined);
    const res = await request(app)
      .post("/users/user-001/reset-password")
      .set("Authorization", tokenFor(systemAdmin))
      .send({ newPassword: "newSecurePass!" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/password reset/i);
  });

  it("forwards userId, newPassword, actorId, actorRole to service.resetPassword", async () => {
    mockAuthQuery(systemAdmin);
    mockResetPassword.mockResolvedValue(undefined);
    await request(app)
      .post("/users/user-001/reset-password")
      .set("Authorization", tokenFor(systemAdmin))
      .send({ newPassword: "newSecurePass!" });
    expect(mockResetPassword).toHaveBeenCalledWith(
      "user-001",
      "newSecurePass!",
      systemAdmin.id,
      systemAdmin.role
    );
  });

  it("returns 400 when service throws (e.g. user not found)", async () => {
    mockAuthQuery(systemAdmin);
    mockResetPassword.mockRejectedValue(new Error("User not found: user-999"));
    const res = await request(app)
      .post("/users/user-999/reset-password")
      .set("Authorization", tokenFor(systemAdmin))
      .send({ newPassword: "newSecurePass!" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/user not found/i);
  });
});
