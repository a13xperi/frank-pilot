/**
 * HIGH-1 (SECURITY-AUDIT-2026-05-21): tenant-portal `requireEmailVerified`
 * lifted to the router-level chain at src/modules/tenant/routes.ts:45.
 *
 * Before this PR, the eight read/write routes below relied on
 *   `authenticate + requireTenantRole + scopeToOwnApplications`
 * alone, allowing any holder of a tenant/applicant JWT to read PII or
 * post payment + maintenance mutations even after `email_verified_at`
 * was administratively cleared. Two of the ten tenant routes
 * (POST /messages, POST /messages/:msgId/read) already self-gated.
 *
 * The fix lifts `requireEmailVerified` into the router chain so all ten
 * routes share the same WARN #2 floor. Each test below issues a JWT
 * with `emailVerified: false` against a users row whose
 * `email_verified_at = null`, then asserts `403 EMAIL_UNVERIFIED`.
 *
 * Mock order mirrors the new chain:
 *   authenticate (mockUsersRow) → requireTenantRole (no query) →
 *   requireEmailVerified (no query — short-circuits 403) →
 *   scopeToOwnApplications (NOT reached on unverified path).
 */
import express from "express";
import request from "supertest";
import { generateToken, AuthUser } from "../../../middleware/auth";

jest.mock("../../../config/database", () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));
jest.mock("../../../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { query } from "../../../config/database";
import tenantRouter from "../routes";

const mockQuery = query as jest.MockedFunction<typeof query>;

const app = express();
app.use(express.json());
app.use("/tenant", tenantRouter);

// Stub the users row that authenticate() reads.
function mockUsersRow(user: AuthUser, emailVerifiedAt: Date | null) {
  mockQuery.mockResolvedValueOnce({
    rows: [
      {
        id: user.id,
        email: user.email,
        role: user.role,
        first_name: user.firstName,
        last_name: user.lastName,
        property_ids: user.propertyIds ?? [],
        is_active: true,
        email_verified_at: emailVerifiedAt,
      },
    ],
  } as any);
}

const unverifiedApplicant: AuthUser = {
  id: "user-applicant-unverified",
  email: "unverified@example.com",
  role: "applicant",
  firstName: "Un",
  lastName: "Verified",
  propertyIds: [],
  emailVerified: false,
};

describe("HIGH-1 — router-level requireEmailVerified gates all tenant routes", () => {
  beforeEach(() => jest.clearAllMocks());

  // Eight routes that previously had NO email-verified gate. With the
  // router-level lift, an unverified applicant must hit 403 EMAIL_UNVERIFIED
  // on every one of them — before any handler logic runs.
  const newlyGatedRoutes: Array<["get" | "post", string]> = [
    ["get", "/tenant/me"],
    ["get", "/tenant/dashboard"],
    ["get", "/tenant/applications/some-app-id/ledger"],
    ["post", "/tenant/applications/some-app-id/pay"],
    ["get", "/tenant/maintenance"],
    ["post", "/tenant/maintenance"],
    ["get", "/tenant/applications/some-app-id"],
    ["get", "/tenant/applications/some-app-id/messages"],
  ];

  test.each(newlyGatedRoutes)(
    "%s %s → 403 EMAIL_UNVERIFIED for an unverified applicant",
    async (method, path) => {
      const token = generateToken(unverifiedApplicant, { emailVerified: false });

      // authenticate() reads users row; email_verified_at = null forces
      // req.user.emailVerified = false regardless of the token claim.
      mockUsersRow(unverifiedApplicant, null);
      // scopeToOwnApplications is NOT reached because requireEmailVerified
      // short-circuits with 403 first. No further mocks needed.

      const req = (request(app) as any)[method](path).set(
        "Authorization",
        `Bearer ${token}`
      );
      const res =
        method === "post" ? await req.send({}) : await req.send();

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("EMAIL_UNVERIFIED");
    }
  );
});
