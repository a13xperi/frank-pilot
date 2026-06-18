/**
 * BP-02 compliance-tape viewer flag gate (src/index.ts half).
 *
 * The viewer routes (/api/compliance-tape/{list,verify,export.pdf}) are mounted
 * in src/index.ts only when COMPLIANCE_TAPE_V2_ENABLED === "true". The flag is
 * read at module-eval time, so the env var MUST be set BEFORE the app module is
 * required, and jest.resetModules() is used between flag states.
 *
 * Phase 2 cutover: the mount now injects the REAL TapeService (Lane B) instead
 * of the inert Phase-1 stub. Assertions:
 *   - flag === "true"  → routes mounted → the real service runs against the
 *     (mocked, empty) compliance_tape table → /verify?applicantId=<uuid> yields
 *     a clean empty-chain result {ok:true, lastSequence:0} (200); a request with
 *     no applicantId still 501s (global scope unimplemented in v1).
 *   - flag unset/false → routes NOT mounted → request falls through to the
 *     404 "Not found" handler.
 *
 * This mirrors the verify-cron gate asserted in scheduler-bp02-flag.test.ts.
 */

import request from "supertest";
import type { Express } from "express";

/**
 * config/database mock.  PgTapeRepository runs every read inside transaction(),
 * so the mock invokes the callback with a fake client whose query() returns an
 * empty result set.  repo.list() therefore resolves to [] and the real
 * TapeService.verify() returns a clean empty-chain result.  The standalone
 * query() (used by authenticate/RBAC, NOT the repo) is left as a bare jest.fn()
 * the test arms per-case.
 */
function makeDbMock() {
  return {
    query: jest.fn(),
    transaction: jest.fn(
      async (cb: (client: { query: jest.Mock }) => unknown) =>
        cb({ query: jest.fn().mockResolvedValue({ rows: [] }) })
    ),
  };
}

// Mocks must be declared before the app module is required. (jest.mock is
// hoisted, so the factory cannot reference makeDbMock — inline the same shape.
// Type annotations are erased, so `jest.Mock` as a type is safe here.)
jest.mock("../config/database", () => ({
  query: jest.fn(),
  transaction: jest.fn(
    async (cb: (client: { query: jest.Mock }) => unknown) =>
      cb({ query: jest.fn().mockResolvedValue({ rows: [] }) })
  ),
}));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const ORIGINAL_FLAG = process.env.COMPLIANCE_TAPE_V2_ENABLED;
const ORIGINAL_JWT = process.env.JWT_SECRET;

/**
 * Set the flag, reset the module registry, and require a fresh copy of the app
 * so the COMPLIANCE_TAPE_V2_ENABLED check in src/index.ts re-evaluates.
 */
function loadAppWithFlag(flag: string | undefined): Express {
  jest.resetModules();
  if (flag === undefined) {
    delete process.env.COMPLIANCE_TAPE_V2_ENABLED;
  } else {
    process.env.COMPLIANCE_TAPE_V2_ENABLED = flag;
  }
  // Re-apply mocks against the freshly-reset registry. jest.doMock is NOT
  // hoisted, so it can use the shared makeDbMock() factory.
  jest.doMock("../config/database", () => makeDbMock());
  jest.doMock("../utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  }));
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../index").default as Express;
}

/**
 * Load the app with the flag ON and arm the standalone query() mock with an
 * operator user so authenticate + requirePermission("audit:view") pass.
 * Returns the mounted app + a signed token for that operator.
 */
function loadMountedAppWithOperator(): { app: Express; token: string } {
  const app = loadAppWithFlag("true");

  // generateToken is re-required from the reset registry so it signs with the
  // same JWT_SECRET the freshly-loaded app verifies against.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { generateToken } = require("../middleware/auth");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { query } = require("../config/database") as { query: jest.Mock };

  const user = {
    id: "user-rm-001",
    email: "rm@example.com",
    role: "regional_manager",
    firstName: "Rita",
    lastName: "Manager",
    propertyIds: ["prop-001"],
  };
  // authenticate re-reads the user from the DB via the standalone query().
  query.mockResolvedValue({
    rows: [
      {
        id: user.id,
        email: user.email,
        role: user.role,
        first_name: user.firstName,
        last_name: user.lastName,
        property_ids: user.propertyIds,
        is_active: true,
        email_verified_at: new Date().toISOString(),
      },
    ],
  });

  return { app, token: generateToken(user) };
}

beforeAll(() => {
  // A stable secret so generateToken / authenticate agree on signing.
  process.env.JWT_SECRET = "test-secret-bp02-flag";
});

afterAll(() => {
  if (ORIGINAL_FLAG === undefined) {
    delete process.env.COMPLIANCE_TAPE_V2_ENABLED;
  } else {
    process.env.COMPLIANCE_TAPE_V2_ENABLED = ORIGINAL_FLAG;
  }
  if (ORIGINAL_JWT === undefined) {
    delete process.env.JWT_SECRET;
  } else {
    process.env.JWT_SECRET = ORIGINAL_JWT;
  }
});

describe("BP-02 compliance-tape viewer flag gate", () => {
  // First test in the suite pays the full-app cold boot inside
  // loadAppWithFlag(); under loaded CI runners that alone can blow the 5s
  // default (flaked 4x on Jun 12 across main/#297/#299). 15s is boot
  // headroom, not a behavior change.
  it("falls through to the 404 handler when the flag is unset (default OFF)", async () => {
    const app = loadAppWithFlag(undefined);
    const res = await request(app).get("/api/compliance-tape/list");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not found" });
  }, 15_000);

  it("falls through to the 404 handler when the flag is the string \"false\"", async () => {
    const app = loadAppWithFlag("false");
    const res = await request(app).get("/api/compliance-tape/list");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not found" });
  });

  it("mounts the viewer routes with the REAL service when the flag is \"true\"", async () => {
    const { app, token } = loadMountedAppWithOperator();

    // Route IS mounted (not 404) and the real TapeService runs end-to-end
    // against the mocked-empty compliance_tape table → clean empty-chain verify.
    const res = await request(app)
      .get(
        "/api/compliance-tape/verify?applicantId=11111111-1111-1111-1111-111111111111"
      )
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      scope: {
        type: "applicant",
        applicantId: "11111111-1111-1111-1111-111111111111",
      },
      lastSequence: 0,
    });
    // No longer the Phase-1 stub.
    expect(res.status).not.toBe(503);
  });

  it("mounts the routes but 501s global scope (no applicantId) when the flag is \"true\"", async () => {
    const { app, token } = loadMountedAppWithOperator();

    const res = await request(app)
      .get("/api/compliance-tape/verify")
      .set("Authorization", `Bearer ${token}`);

    // Proves the route is mounted (not 404) AND the real service path is hit:
    // resolveScope(undefined) short-circuits to 501 before touching the repo.
    expect(res.status).toBe(501);
    expect(res.body).toMatchObject({ code: "global_scope_not_implemented" });
  });
});
