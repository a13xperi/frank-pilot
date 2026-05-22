/**
 * PR #4 follow-up P0 tests for the messaging endpoints.
 *
 * Covers:
 *   - P0 #1 / #5 — markRead UPDATE scopes by application_id so an owner of
 *     one application can no longer flip read_at on a message belonging to
 *     a different application (IDOR closure).
 *   - P0 #2 — POST /messages emits standard RateLimit-* headers.
 *   - P0 #3 — Tenant POST /messages is gated by requireEmailVerified (the
 *     same WARN #2 floor every other applicant mutating surface uses).
 *   - wedge #13 — POST /messages is gated by Turnstile when a real secret is
 *     set; a failing siteverify response must produce 403
 *     turnstile_verification_failed before the route handler runs.
 *
 * Strategy: real JWTs decoded against the mocked users DB row, then a
 * queue-mocked `query` chain matching the order of the route handlers
 * (authenticate → scopeToOwnApplications → assertApplicationOwnership →
 * service.markRead).
 */
import express from "express";
import request from "supertest";
import { generateToken, AuthUser } from "../middleware/auth";

jest.mock("../config/database", () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { query, transaction } from "../config/database";
import tenantRouter from "../modules/tenant/routes";

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockTransaction = transaction as jest.MockedFunction<typeof transaction>;

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

// scopeToOwnApplications → SELECT application_id FROM user_applications.
function mockScopedApps(applicationIds: string[]) {
  mockQuery.mockResolvedValueOnce({
    rows: applicationIds.map((id) => ({ application_id: id })),
  } as any);
}

// assertApplicationOwnership → SELECT 1 FROM user_applications.
function mockOwnership(allow: boolean) {
  mockQuery.mockResolvedValueOnce({
    rows: allow ? [{ "?column?": 1 }] : [],
  } as any);
}

const VERIFIED_AT = new Date("2026-05-14T00:00:00Z");

const verifiedUser: AuthUser = {
  id: "user-tenant-1",
  email: "tenant@example.com",
  role: "tenant",
  firstName: "T",
  lastName: "Enant",
  propertyIds: [],
  emailVerified: true,
};

const unverifiedApplicant: AuthUser = {
  ...verifiedUser,
  id: "user-applicant-unverified",
  email: "unverified@example.com",
  role: "applicant",
  emailVerified: false,
};

describe("PR #4 P0 follow-ups — messaging routes", () => {
  // resetAllMocks (not clearAllMocks) so unused mockResolvedValueOnce
  // queue entries do not leak between tests. HIGH-1 lifted
  // requireEmailVerified ahead of scopeToOwnApplications on the router
  // chain, which means the unverified-path tests below no longer reach
  // scopeToOwnApplications — their mockScopedApps stub would otherwise
  // pollute the next test's queue.
  beforeEach(() => jest.resetAllMocks());

  describe("P0 #1 / #5 — markRead IDOR scoped by application_id", () => {
    it("scopes the UPDATE by application_id so a foreign message cannot be flipped", async () => {
      const ownedAppId = "app-owned-by-user";
      const foreignMsgId = "msg-belonging-to-another-app";
      const token = generateToken(verifiedUser);

      mockUsersRow(verifiedUser, VERIFIED_AT);
      mockScopedApps([ownedAppId]);
      mockOwnership(true);
      // markRead UPDATE: 0 rows updated because application_id mismatch
      // would prune the row in the production query — the test asserts the
      // SQL/params shape that drives that pruning.
      mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] } as any);

      const res = await request(app)
        .post(`/tenant/applications/${ownedAppId}/messages/${foreignMsgId}/read`)
        .set("Authorization", `Bearer ${token}`)
        .send();

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ updated: false });

      // Inspect the UPDATE call (4th mockQuery invocation: authenticate,
      // scopeToOwnApplications, assertApplicationOwnership, then markRead).
      const updateCall = mockQuery.mock.calls[3];
      expect(updateCall).toBeDefined();
      const [sql, params] = updateCall as [string, unknown[]];
      // The scope predicate must be on the UPDATE.
      expect(sql).toMatch(/application_id\s*=\s*\$2/);
      expect(sql).toMatch(/UPDATE\s+application_messages/i);
      // Param positions: [messageId, applicationId, readerUserId]
      expect(params[0]).toBe(foreignMsgId);
      expect(params[1]).toBe(ownedAppId);
      expect(params[2]).toBe(verifiedUser.id);
    });

    it("returns updated:true when the message legitimately belongs to the owned application", async () => {
      const ownedAppId = "app-owned-by-user";
      const ownMsgId = "msg-on-owned-app";
      const token = generateToken(verifiedUser);

      mockUsersRow(verifiedUser, VERIFIED_AT);
      mockScopedApps([ownedAppId]);
      mockOwnership(true);
      mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: ownMsgId }] } as any);

      const res = await request(app)
        .post(`/tenant/applications/${ownedAppId}/messages/${ownMsgId}/read`)
        .set("Authorization", `Bearer ${token}`)
        .send();

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ updated: true });
    });
  });

  describe("P0 #3 — requireEmailVerified gates tenant message POST", () => {
    it("rejects an unverified applicant with 403 EMAIL_UNVERIFIED on POST /messages", async () => {
      const ownedAppId = "app-owned-by-unverified";
      const token = generateToken(unverifiedApplicant, { emailVerified: false });

      // authenticate users row — email_verified_at is null → emailVerified=false
      mockUsersRow(unverifiedApplicant, null);
      // HIGH-1: requireEmailVerified now runs BEFORE scopeToOwnApplications
      // on the router chain — no scopedApps stub needed for the unverified
      // path, the chain short-circuits at requireEmailVerified.

      const res = await request(app)
        .post(`/tenant/applications/${ownedAppId}/messages`)
        .set("Authorization", `Bearer ${token}`)
        .send({ body: "spam attempt" });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("EMAIL_UNVERIFIED");
    });

    it("rejects an unverified applicant on POST /:msgId/read as well", async () => {
      const ownedAppId = "app-owned-by-unverified";
      const someMsgId = "any-msg-id";
      const token = generateToken(unverifiedApplicant, { emailVerified: false });

      mockUsersRow(unverifiedApplicant, null);
      // HIGH-1: see note above — scopeToOwnApplications is not reached.

      const res = await request(app)
        .post(`/tenant/applications/${ownedAppId}/messages/${someMsgId}/read`)
        .set("Authorization", `Bearer ${token}`)
        .send();

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("EMAIL_UNVERIFIED");
    });
  });

  describe("P0 #2 — rate-limit headers present on POST /messages", () => {
    it("emits RateLimit-* standard headers on a verified message POST", async () => {
      const ownedAppId = "app-owned-by-user";
      const token = generateToken(verifiedUser);

      mockUsersRow(verifiedUser, VERIFIED_AT);
      mockScopedApps([ownedAppId]);
      mockOwnership(true);
      // service.create runs in a transaction; stub it to return a hydrated row.
      mockTransaction.mockImplementationOnce(async (fn: any) => {
        const client = {
          query: jest
            .fn()
            // INSERT … RETURNING id
            .mockResolvedValueOnce({ rows: [{ id: "msg-new" }] })
            // hydrate SELECT
            .mockResolvedValueOnce({
              rows: [
                {
                  id: "msg-new",
                  application_id: ownedAppId,
                  sender_user_id: verifiedUser.id,
                  sender_role: "tenant",
                  body: "hi",
                  created_at: new Date(),
                  read_at: null,
                  first_name: "T",
                  last_name: "Enant",
                  email: verifiedUser.email,
                },
              ],
            }),
        };
        return fn(client);
      });

      const res = await request(app)
        .post(`/tenant/applications/${ownedAppId}/messages`)
        .set("Authorization", `Bearer ${token}`)
        .send({ body: "hi" });

      expect(res.status).toBe(201);
      // express-rate-limit with standardHeaders:true emits RateLimit-Limit + Remaining.
      expect(res.headers["ratelimit-limit"]).toBeDefined();
      expect(res.headers["ratelimit-remaining"]).toBeDefined();
    });
  });

  describe("wedge #13 — Turnstile gates POST /messages", () => {
    // Save and restore TURNSTILE_SECRET_KEY + globalThis.fetch around each test.
    const ORIGINAL_SECRET = process.env.TURNSTILE_SECRET_KEY;
    const ORIGINAL_FETCH = (globalThis as any).fetch;

    afterEach(() => {
      if (ORIGINAL_SECRET === undefined) {
        delete process.env.TURNSTILE_SECRET_KEY;
      } else {
        process.env.TURNSTILE_SECRET_KEY = ORIGINAL_SECRET;
      }
      (globalThis as any).fetch = ORIGINAL_FETCH;
    });

    it("rejects with 403 turnstile_verification_failed when siteverify returns success:false", async () => {
      // Activate Turnstile enforcement by setting a real-looking secret key.
      process.env.TURNSTILE_SECRET_KEY = "real-secret-for-test";

      // Stub globalThis.fetch to simulate a Cloudflare siteverify rejection.
      // The verifyTurnstile middleware falls back to globalThis.fetch when no
      // fetchImpl option is provided (which is the case for routes wired via
      // verifyTurnstile() with no args).
      (globalThis as any).fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: false, "error-codes": ["invalid-input-response"] }),
      });

      const ownedAppId = "app-owned-by-user";
      const token = generateToken(verifiedUser);

      // The tenant router.use chain runs: authenticate → requireTenantRole →
      // requireEmailVerified → scopeToOwnApplications — all before the
      // route-level verifyTurnstile(). Stub each DB query in order.
      mockUsersRow(verifiedUser, VERIFIED_AT);
      // scopeToOwnApplications → getUserApplicationIds SELECT
      mockScopedApps([ownedAppId]);

      const res = await request(app)
        .post(`/tenant/applications/${ownedAppId}/messages`)
        .set("Authorization", `Bearer ${token}`)
        .send({ body: "spam payload", turnstileToken: "bad-token" });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe("turnstile_verification_failed");
    });
  });
});
