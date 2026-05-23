/**
 * Wedge #10 — tenant-facing password-reset surface.
 *
 * Tests the route layer for POST /users/me/password-reset-email. Tenants and
 * applicants authenticate via magic-link, so a "password reset" for them is a
 * fresh sign-in link to their proven email. Contract:
 *   - 204 on success (link delivered out-of-band)
 *   - 401 without auth
 *   - 403 for staff roles (they have passwords; they should use the admin reset)
 *   - 400 for stray body keys
 *   - 429 on per-user rate-limit trip
 *
 * Mocks: magic-link-service (so we don't hit DB / Resend), users DB query in
 * `authenticate`, and the audit-log writer. The route handler is otherwise
 * exercised end-to-end through supertest.
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

const mockCreateMagicLink = jest.fn();
const mockLogMagicLink = jest.fn();
const mockSendMagicLink = jest.fn();
jest.mock("../modules/auth/magic-link-service", () => ({
  createMagicLink: (...args: unknown[]) => mockCreateMagicLink(...args),
  logMagicLink: (...args: unknown[]) => mockLogMagicLink(...args),
  sendMagicLink: (...args: unknown[]) => mockSendMagicLink(...args),
  verifyMagicLink: jest.fn(),
}));

const mockWriteAuditLog = jest.fn().mockResolvedValue(undefined);
jest.mock("../middleware/audit", () => ({
  writeAuditLog: (...args: unknown[]) => mockWriteAuditLog(...args),
}));

// UserService is instantiated at route scope but the new endpoint doesn't
// touch it. Stub it so the import doesn't surprise the test.
jest.mock("../modules/users/service", () => ({
  UserService: jest.fn().mockImplementation(() => ({
    list: jest.fn(),
    getById: jest.fn(),
    create: jest.fn(),
    setActive: jest.fn(),
    resetPassword: jest.fn(),
  })),
}));

import { query } from "../config/database";
import userRouter from "../modules/users/routes";

const mockQuery = query as jest.MockedFunction<typeof query>;

// ── Test users ─────────────────────────────────────────────────────────────

const applicant: AuthUser = {
  id: "user-app-001",
  email: "applicant@example.com",
  role: "applicant",
  firstName: "Alice",
  lastName: "Applicant",
  propertyIds: [],
  emailVerified: true,
};

const tenant: AuthUser = {
  id: "user-ten-001",
  email: "tenant@example.com",
  role: "tenant",
  firstName: "Tom",
  lastName: "Tenant",
  propertyIds: [],
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

/** Mock the users DB query that `authenticate` runs on every request. */
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

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/users", userRouter);
  return app;
}

const app = buildApp();

describe("POST /users/me/password-reset-email", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: createMagicLink resolves with a fake link.
    mockCreateMagicLink.mockResolvedValue({
      link: "http://portal.test/auth/callback?token=xyz",
      userId: applicant.id,
    });
  });

  it("returns 401 without auth", async () => {
    const res = await request(app).post("/users/me/password-reset-email").send({});
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/authentication required/i);
    expect(mockCreateMagicLink).not.toHaveBeenCalled();
    expect(mockSendMagicLink).not.toHaveBeenCalled();
  });

  it("returns 204 for an applicant and fires the magic-link email", async () => {
    mockAuthQuery(applicant);

    const res = await request(app)
      .post("/users/me/password-reset-email")
      .set("Authorization", tokenFor(applicant))
      .send({});

    expect(res.status).toBe(204);
    // 204 body is empty by HTTP spec.
    expect(res.text).toBe("");

    expect(mockCreateMagicLink).toHaveBeenCalledWith(applicant.email);
    expect(mockLogMagicLink).toHaveBeenCalledWith(
      applicant.email,
      expect.stringContaining("/auth/callback?token=")
    );
    expect(mockSendMagicLink).toHaveBeenCalledWith(
      applicant.email,
      expect.stringContaining("/auth/callback?token="),
      { firstName: applicant.firstName }
    );
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "permission_change",
        actorId: applicant.id,
        actorRole: "applicant",
        resourceId: applicant.id,
        details: expect.objectContaining({
          action: "tenant_password_reset_email_requested",
          targetEmail: applicant.email,
        }),
      })
    );
  });

  it("returns 204 for a tenant role", async () => {
    mockAuthQuery(tenant);

    const res = await request(app)
      .post("/users/me/password-reset-email")
      .set("Authorization", tokenFor(tenant))
      .send({});

    expect(res.status).toBe(204);
    expect(mockSendMagicLink).toHaveBeenCalledWith(
      tenant.email,
      expect.any(String),
      { firstName: tenant.firstName }
    );
  });

  it("returns 403 for staff roles (system_admin)", async () => {
    mockAuthQuery(systemAdmin);

    const res = await request(app)
      .post("/users/me/password-reset-email")
      .set("Authorization", tokenFor(systemAdmin))
      .send({});

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/only for tenants and applicants/i);
    // Crucial: no magic-link issued, no audit row written.
    expect(mockCreateMagicLink).not.toHaveBeenCalled();
    expect(mockSendMagicLink).not.toHaveBeenCalled();
    expect(mockWriteAuditLog).not.toHaveBeenCalled();
  });

  it("returns 403 for senior_manager (staff)", async () => {
    mockAuthQuery(seniorManager);

    const res = await request(app)
      .post("/users/me/password-reset-email")
      .set("Authorization", tokenFor(seniorManager))
      .send({});

    expect(res.status).toBe(403);
    expect(mockSendMagicLink).not.toHaveBeenCalled();
  });

  it("returns 400 when body contains stray properties (e.g. forged email)", async () => {
    mockAuthQuery(applicant);

    const res = await request(app)
      .post("/users/me/password-reset-email")
      .set("Authorization", tokenFor(applicant))
      .send({ email: "victim@example.com" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/validation failed/i);
    // No mail is sent to either address — the JWT subject is the only
    // authority, but we surface the attempt as a 400 so abuse is observable.
    expect(mockSendMagicLink).not.toHaveBeenCalled();
  });

  it("still 204s when createMagicLink returns null (defensive fall-through)", async () => {
    mockAuthQuery(applicant);
    mockCreateMagicLink.mockResolvedValueOnce(null);

    const res = await request(app)
      .post("/users/me/password-reset-email")
      .set("Authorization", tokenFor(applicant))
      .send({});

    expect(res.status).toBe(204);
    expect(mockSendMagicLink).not.toHaveBeenCalled();
    // Audit row still written — the request happened.
    expect(mockWriteAuditLog).toHaveBeenCalled();
  });

  it("returns 500 when createMagicLink throws", async () => {
    // Distinct user id keeps a fresh rate-limit bucket — the previous tests in
    // this file all reused the applicant.id and would otherwise eat into the
    // 3/min ceiling.
    const freshUser: AuthUser = { ...applicant, id: "user-app-fresh-001" };
    mockAuthQuery(freshUser);
    mockCreateMagicLink.mockRejectedValueOnce(new Error("db gone"));

    const res = await request(app)
      .post("/users/me/password-reset-email")
      .set("Authorization", tokenFor(freshUser))
      .send({});

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to send reset email/i);
    expect(mockSendMagicLink).not.toHaveBeenCalled();
  });

  it("trips 429 on the 4th request from the same user within the window", async () => {
    // 3/min limit — burn three good ones, the fourth must 429.
    const burnUser: AuthUser = { ...tenant, id: "user-ten-burn-001" };
    for (let i = 0; i < 3; i++) {
      mockAuthQuery(burnUser);
      const ok = await request(app)
        .post("/users/me/password-reset-email")
        .set("Authorization", tokenFor(burnUser))
        .send({});
      expect(ok.status).toBe(204);
    }
    mockAuthQuery(burnUser);
    const limited = await request(app)
      .post("/users/me/password-reset-email")
      .set("Authorization", tokenFor(burnUser))
      .send({});
    expect(limited.status).toBe(429);
    expect(limited.body.error).toMatch(/too many requests/i);
  });
});
