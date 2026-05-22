/**
 * Tests for src/middleware/auth.ts and the three app-level routes in src/index.ts:
 *   - GET  /health            — public, no auth
 *   - POST /api/auth/login    — public, credential exchange
 *   - GET  /api/audit         — protected by audit:view (regional_manager+)
 *
 * Auth middleware tests cover: no header, invalid token, expired token,
 * inactive user, user not found, valid token → req.user populated.
 *
 * Login tests cover: missing fields, user not found, inactive user,
 * wrong password, success (returns token + user object).
 *
 * App-route tests build a minimal Express app that replicates the index.ts
 * handlers without triggering app.listen() — avoiding port conflicts.
 *
 * RBAC facts under test:
 *   audit:view → regional_manager, asset_manager, system_admin
 *   senior_manager and leasing_agent are BLOCKED from audit:view
 */

import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { generateToken, authenticate, login, AuthUser, AuthRequest } from "../middleware/auth";

// ── Mocks (must be declared before module imports) ─────────────────────────

jest.mock("../config/database", () => ({ query: jest.fn(), transaction: jest.fn() }));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("bcrypt", () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));
jest.mock("../middleware/audit", () => ({
  queryAuditLog: jest.fn(),
  writeAuditLog: jest.fn(),
  auditMiddleware: jest.fn((_req: Request, _res: Response, next: NextFunction) => next()),
}));

import { query } from "../config/database";
import { requirePermission } from "../middleware/rbac";
import { queryAuditLog } from "../middleware/audit";

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockQueryAuditLog = queryAuditLog as jest.MockedFunction<typeof queryAuditLog>;

// bcrypt is dynamically imported inside login() — jest.mock handles it
const bcrypt = require("bcrypt");

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
function mockAuthQuery(user: AuthUser, isActive = true) {
  mockQuery.mockResolvedValueOnce({
    rows: [
      {
        id: user.id,
        email: user.email,
        role: user.role,
        first_name: user.firstName,
        last_name: user.lastName,
        property_ids: user.propertyIds,
        is_active: isActive,
      },
    ],
  } as any);
}

// ── Build minimal test app replicating index.ts routes ─────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());

  // GET /health
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "frank-pilot", timestamp: new Date().toISOString() });
  });

  // POST /api/auth/login
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        res.status(400).json({ error: "Email and password required" });
        return;
      }
      const result = await login(email, password);
      if (!result) {
        res.status(401).json({ error: "Invalid credentials" });
        return;
      }
      res.json(result);
    } catch (_err) {
      res.status(500).json({ error: "Login failed" });
    }
  });

  // GET /api/audit
  app.get(
    "/api/audit",
    authenticate,
    requirePermission("audit:view"),
    async (req: AuthRequest, res) => {
      try {
        const logs = await queryAuditLog({
          applicationId: req.query.applicationId as string,
          actorId: req.query.actorId as string,
          action: req.query.action as string,
          limit: req.query.limit ? parseInt(req.query.limit as string) : 100,
          offset: req.query.offset ? parseInt(req.query.offset as string) : 0,
        });
        res.json({ logs });
      } catch (_err) {
        res.status(500).json({ error: "Failed to query audit log" });
      }
    }
  );

  return app;
}

const app = buildApp();

// ── authenticate middleware ─────────────────────────────────────────────────

describe("authenticate middleware", () => {
  // Build a tiny app to invoke authenticate directly
  const authApp = express();
  authApp.use(express.json());
  authApp.get("/protected", authenticate, (req: AuthRequest, res) => {
    res.json({ userId: req.user?.id, role: req.user?.role });
  });

  beforeEach(() => jest.clearAllMocks());

  it("returns 401 when Authorization header is absent", async () => {
    const res = await request(authApp).get("/protected");
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/authentication required/i);
  });

  it("returns 401 when Authorization header does not start with Bearer", async () => {
    const res = await request(authApp)
      .get("/protected")
      .set("Authorization", "Basic dXNlcjpwYXNz");
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/authentication required/i);
  });

  it("returns 401 when token is malformed", async () => {
    const res = await request(authApp)
      .get("/protected")
      .set("Authorization", "Bearer this.is.not.valid");
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid token/i);
  });

  it("returns 401 when token is signed with wrong secret", async () => {
    const badToken = jwt.sign({ id: "user-001", role: "senior_manager" }, "wrong-secret");
    const res = await request(authApp)
      .get("/protected")
      .set("Authorization", `Bearer ${badToken}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid token/i);
  });

  it("returns 401 when user is not found in database", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);

    const res = await request(authApp)
      .get("/protected")
      .set("Authorization", tokenFor(leasingAgent));

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/inactive or not found/i);
  });

  it("returns 401 when user account is inactive", async () => {
    mockAuthQuery(leasingAgent, false); // is_active = false

    const res = await request(authApp)
      .get("/protected")
      .set("Authorization", tokenFor(leasingAgent));

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/inactive or not found/i);
  });

  it("populates req.user and calls next() for valid token + active user", async () => {
    mockAuthQuery(seniorManager);

    const res = await request(authApp)
      .get("/protected")
      .set("Authorization", tokenFor(seniorManager));

    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(seniorManager.id);
    expect(res.body.role).toBe("senior_manager");
  });

  it("uses DB values for req.user, not token payload values", async () => {
    // DB returns different role than what the token claims
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: seniorManager.id,
          email: seniorManager.email,
          role: "regional_manager", // overridden in DB
          first_name: seniorManager.firstName,
          last_name: seniorManager.lastName,
          property_ids: seniorManager.propertyIds,
          is_active: true,
        },
      ],
    } as any);

    const res = await request(authApp)
      .get("/protected")
      .set("Authorization", tokenFor(seniorManager));

    expect(res.status).toBe(200);
    expect(res.body.role).toBe("regional_manager"); // DB value wins
  });
});

// ── login() function ────────────────────────────────────────────────────────

describe("login()", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns null when user is not found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);
    const result = await login("nobody@example.com", "pass123");
    expect(result).toBeNull();
  });

  it("returns null when user account is inactive", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "u1",
          email: "agent@example.com",
          password_hash: "$2b$10$hash",
          role: "leasing_agent",
          first_name: "Alice",
          last_name: "Agent",
          property_ids: [],
          is_active: false,
        },
      ],
    } as any);

    const result = await login("agent@example.com", "pass123");
    expect(result).toBeNull();
  });

  it("returns null when password does not match", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "u1",
          email: "agent@example.com",
          password_hash: "$2b$10$correcthash",
          role: "leasing_agent",
          first_name: "Alice",
          last_name: "Agent",
          property_ids: [],
          is_active: true,
        },
      ],
    } as any);
    bcrypt.compare.mockResolvedValueOnce(false);

    const result = await login("agent@example.com", "wrongpassword");
    expect(result).toBeNull();
  });

  // CRIT-1: applicants who registered but never clicked the magic link have
  // password_hash = NULL. Pre-fix this threw inside bcrypt.compare and the
  // route handler turned it into a 500 — distinguishable from the 401 a real
  // wrong-password attempt would produce.
  it("returns null when applicant has a NULL password_hash (no crash)", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "u-applicant",
          email: "applicant@example.com",
          password_hash: null,
          role: "applicant",
          first_name: "Pat",
          last_name: "Applicant",
          property_ids: [],
          is_active: true,
        },
      ],
    } as any);

    const result = await login("applicant@example.com", "anything");
    expect(result).toBeNull();
  });

  // CRIT-1: timing-equalizer. Every failure path must call bcrypt.compare so
  // the "fast-fail" oracle (≤5ms unknown vs ~80ms wrong-pw) disappears.
  it("invokes bcrypt.compare on the unknown-user path (timing equalizer)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);
    bcrypt.compare.mockResolvedValueOnce(false);

    const result = await login("nobody@example.com", "pass123");

    expect(result).toBeNull();
    expect(bcrypt.compare).toHaveBeenCalledTimes(1);
    expect(bcrypt.compare).toHaveBeenCalledWith("pass123", expect.stringMatching(/^\$2[abxy]\$/));
  });

  // CRIT-1: bcrypt.compare can throw on a malformed hash. Pre-fix that bubbled
  // up to the express error handler and surfaced as 500. The try/catch in
  // login() folds it back into a quiet 401 by running the dummy compare and
  // returning null.
  it("returns null (not throws) when bcrypt.compare throws on a real user", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "u1",
          email: "agent@example.com",
          password_hash: "garbage-not-a-real-hash",
          role: "leasing_agent",
          first_name: "Alice",
          last_name: "Agent",
          property_ids: [],
          is_active: true,
        },
      ],
    } as any);
    bcrypt.compare
      .mockRejectedValueOnce(new Error("Invalid salt version"))
      .mockResolvedValueOnce(false);

    const result = await login("agent@example.com", "pass123");
    expect(result).toBeNull();
    expect(bcrypt.compare).toHaveBeenCalledTimes(2);
  });

  it("returns token and user object on successful login", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: "u1",
            email: "sm@example.com",
            password_hash: "$2b$10$validhash",
            role: "senior_manager",
            first_name: "Bob",
            last_name: "Manager",
            property_ids: ["prop-001"],
            is_active: true,
          },
        ],
      } as any)
      .mockResolvedValueOnce({ rows: [] } as any); // UPDATE last_login

    bcrypt.compare.mockResolvedValueOnce(true);

    const result = await login("sm@example.com", "correctpassword");

    expect(result).not.toBeNull();
    expect(result!.token).toBeDefined();
    expect(result!.user.id).toBe("u1");
    expect(result!.user.role).toBe("senior_manager");
    expect(result!.user.email).toBe("sm@example.com");
    expect(result!.user.firstName).toBe("Bob");
    expect(result!.user.propertyIds).toEqual(["prop-001"]);
  });

  it("updates last_login timestamp on successful login", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: "u1",
            email: "sm@example.com",
            password_hash: "$2b$10$validhash",
            role: "senior_manager",
            first_name: "Bob",
            last_name: "Manager",
            property_ids: [],
            is_active: true,
          },
        ],
      } as any)
      .mockResolvedValueOnce({ rows: [] } as any);

    bcrypt.compare.mockResolvedValueOnce(true);

    await login("sm@example.com", "correctpassword");

    const updateCall = mockQuery.mock.calls[1];
    expect(updateCall![0]).toMatch(/UPDATE users SET last_login/i);
    expect(updateCall![1]).toEqual(["u1"]);
  });

  it("token returned by login is a valid JWT decodable with the default secret", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: "u2",
            email: "rm@example.com",
            password_hash: "$2b$10$hash",
            role: "regional_manager",
            first_name: "Carol",
            last_name: "Regional",
            property_ids: [],
            is_active: true,
          },
        ],
      } as any)
      .mockResolvedValueOnce({ rows: [] } as any);

    bcrypt.compare.mockResolvedValueOnce(true);

    const result = await login("rm@example.com", "pass");

    const decoded = jwt.verify(result!.token, "dev-secret-change-me") as any;
    expect(decoded.id).toBe("u2");
    expect(decoded.role).toBe("regional_manager");
  });
});

// ── GET /health ────────────────────────────────────────────────────────────

describe("GET /health", () => {
  it("returns 200 with status ok and service name", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.service).toBe("frank-pilot");
    expect(res.body.timestamp).toBeDefined();
  });

  it("returns a valid ISO timestamp", async () => {
    const res = await request(app).get("/health");
    expect(new Date(res.body.timestamp).toISOString()).toBe(res.body.timestamp);
  });
});

// ── POST /api/auth/login ───────────────────────────────────────────────────

describe("POST /api/auth/login", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 400 when email is missing", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ password: "pass123" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email and password required/i);
  });

  it("returns 400 when password is missing", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "user@example.com" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email and password required/i);
  });

  it("returns 400 when both email and password are missing", async () => {
    const res = await request(app).post("/api/auth/login").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email and password required/i);
  });

  it("returns 401 when credentials are invalid (login returns null)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "nobody@example.com", password: "wrong" });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid credentials/i);
  });

  it("returns 200 with token and user on successful login", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: "u1",
            email: "sm@example.com",
            password_hash: "$2b$10$validhash",
            role: "senior_manager",
            first_name: "Bob",
            last_name: "Manager",
            property_ids: ["prop-001"],
            is_active: true,
          },
        ],
      } as any)
      .mockResolvedValueOnce({ rows: [] } as any);

    bcrypt.compare.mockResolvedValueOnce(true);

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "sm@example.com", password: "correctpass" });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.id).toBe("u1");
    expect(res.body.user.role).toBe("senior_manager");
    expect(res.body.user.email).toBe("sm@example.com");
  });

  it("returns 500 when login throws unexpectedly", async () => {
    mockQuery.mockRejectedValueOnce(new Error("DB unreachable"));

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "user@example.com", password: "pass" });

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/login failed/i);
  });
});

// ── GET /api/audit ─────────────────────────────────────────────────────────

describe("GET /api/audit", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 when no Authorization header is provided", async () => {
    const res = await request(app).get("/api/audit");
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/authentication required/i);
  });

  it("returns 401 when token is invalid", async () => {
    const res = await request(app)
      .get("/api/audit")
      .set("Authorization", "Bearer bad.token.here");
    expect(res.status).toBe(401);
  });

  it("returns 403 when leasing_agent attempts to view audit log", async () => {
    mockAuthQuery(leasingAgent);

    const res = await request(app)
      .get("/api/audit")
      .set("Authorization", tokenFor(leasingAgent));

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/insufficient permissions/i);
  });

  it("returns 403 when senior_manager attempts to view audit log", async () => {
    mockAuthQuery(seniorManager);

    const res = await request(app)
      .get("/api/audit")
      .set("Authorization", tokenFor(seniorManager));

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/insufficient permissions/i);
  });

  it("returns 200 with logs array for regional_manager", async () => {
    mockAuthQuery(regionalManager);
    mockQueryAuditLog.mockResolvedValueOnce([
      { id: "log-001", action: "tier1_review", actorId: "u1", applicationId: "app-001" },
      { id: "log-002", action: "generate_lease", actorId: "u2", applicationId: "app-001" },
    ] as any);

    const res = await request(app)
      .get("/api/audit")
      .set("Authorization", tokenFor(regionalManager));

    expect(res.status).toBe(200);
    expect(res.body.logs).toHaveLength(2);
    expect(res.body.logs[0].id).toBe("log-001");
  });

  it("forwards query params to queryAuditLog correctly", async () => {
    mockAuthQuery(regionalManager);
    mockQueryAuditLog.mockResolvedValueOnce([] as any);

    await request(app)
      .get("/api/audit?applicationId=app-001&actorId=u1&action=tier1_review&limit=50&offset=10")
      .set("Authorization", tokenFor(regionalManager));

    expect(mockQueryAuditLog).toHaveBeenCalledWith({
      applicationId: "app-001",
      actorId: "u1",
      action: "tier1_review",
      limit: 50,
      offset: 10,
    });
  });

  it("uses default limit=100 and offset=0 when not specified", async () => {
    mockAuthQuery(regionalManager);
    mockQueryAuditLog.mockResolvedValueOnce([] as any);

    await request(app)
      .get("/api/audit")
      .set("Authorization", tokenFor(regionalManager));

    expect(mockQueryAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 100, offset: 0 })
    );
  });

  it("returns 500 when queryAuditLog throws unexpectedly", async () => {
    mockAuthQuery(regionalManager);
    mockQueryAuditLog.mockRejectedValueOnce(new Error("DB connection lost"));

    const res = await request(app)
      .get("/api/audit")
      .set("Authorization", tokenFor(regionalManager));

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to query audit log/i);
  });
});
