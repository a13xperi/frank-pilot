/**
 * BP-02 compliance-tape viewer flag gate (src/index.ts half).
 *
 * The viewer routes (/api/compliance-tape/{list,verify,export.pdf}) are mounted
 * in src/index.ts only when COMPLIANCE_TAPE_V2_ENABLED === "true". The flag is
 * read at module-eval time, so the env var MUST be set BEFORE the app module is
 * required, and jest.resetModules() is used between flag states.
 *
 * Assertions:
 *   - flag === "true"  → routes mounted → stub service throws → 503 (unchanged).
 *   - flag unset/false → routes NOT mounted → request falls through to the
 *     404 "Not found" handler (was: 503 stub always).
 *
 * This mirrors the verify-cron gate asserted in scheduler-bp02-flag.test.ts.
 */

import request from "supertest";
import type { Express } from "express";

// Mocks must be declared before the app module is required.
jest.mock("../config/database", () => ({
  query: jest.fn(),
  transaction: jest.fn(),
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
  // Re-apply mocks against the freshly-reset registry.
  jest.doMock("../config/database", () => ({
    query: jest.fn(),
    transaction: jest.fn(),
  }));
  jest.doMock("../utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  }));
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../index").default as Express;
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
  it("falls through to the 404 handler when the flag is unset (default OFF)", async () => {
    const app = loadAppWithFlag(undefined);
    const res = await request(app).get("/api/compliance-tape/list");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not found" });
  });

  it("falls through to the 404 handler when the flag is the string \"false\"", async () => {
    const app = loadAppWithFlag("false");
    const res = await request(app).get("/api/compliance-tape/list");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not found" });
  });

  it("mounts the viewer routes when the flag is \"true\" (stub → 503)", async () => {
    const app = loadAppWithFlag("true");

    // The routes require auth + audit:view, so a forged user is resolved from
    // the mocked DB. generateToken is re-required from the reset registry so it
    // signs with the same JWT_SECRET the freshly-loaded app verifies against.
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
    // authenticate re-reads the user from the DB.
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

    const token = generateToken(user);
    // verify route is the cleanest stub path (no zod global-scope short-circuit).
    const res = await request(app)
      .get(
        "/api/compliance-tape/verify?applicantId=11111111-1111-1111-1111-111111111111"
      )
      .set("Authorization", `Bearer ${token}`);

    // Route IS mounted (not 404) and the stub service yields the 503.
    expect(res.status).toBe(503);
  });
});
