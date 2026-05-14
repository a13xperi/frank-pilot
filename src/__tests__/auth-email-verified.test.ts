/**
 * WARN #2 middleware-level tests: authenticate() emailVerified resolution.
 *
 * The contract:
 *  - A token with no `emailVerified` claim resolves to false (legacy/forged).
 *  - The DB column `users.email_verified_at` always wins over the token's claim
 *    in BOTH directions:
 *      * token says true, DB says null → req.user.emailVerified = false
 *      * token says false, DB says timestamped → req.user.emailVerified = true
 */
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { authenticate, AuthRequest, generateToken, AuthUser } from "../middleware/auth";

jest.mock("../config/database", () => ({ query: jest.fn(), transaction: jest.fn() }));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { query } from "../config/database";
const mockQuery = query as jest.MockedFunction<typeof query>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.get("/protected", authenticate, (req: AuthRequest, res) => {
    res.json({ emailVerified: req.user?.emailVerified });
  });
  return app;
}
const app = buildApp();

const user: AuthUser = {
  id: "u-001",
  email: "a@x.com",
  role: "applicant",
  firstName: "A",
  lastName: "A",
  propertyIds: [],
  emailVerified: false,
};

function mockUsersRow(emailVerifiedAt: Date | null) {
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
        email_verified_at: emailVerifiedAt,
      },
    ],
  } as any);
}

describe("authenticate() emailVerified resolution (WARN #2)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("DB null overrides a token claiming emailVerified=true", async () => {
    mockUsersRow(null);
    const token = generateToken(user, { emailVerified: true }); // attacker-forged or stale
    const res = await request(app)
      .get("/protected")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.emailVerified).toBe(false);
  });

  it("DB timestamped overrides a token claiming emailVerified=false (stale token upgrade)", async () => {
    mockUsersRow(new Date("2026-05-13T12:00:00Z"));
    const token = generateToken(user, { emailVerified: false });
    const res = await request(app)
      .get("/protected")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.emailVerified).toBe(true);
  });

  it("a legacy token with no emailVerified claim resolves from DB (here: false)", async () => {
    mockUsersRow(null);
    // Hand-craft a token without the emailVerified claim
    const legacy = jwt.sign(
      { id: user.id, email: user.email, role: user.role, firstName: user.firstName, lastName: user.lastName, propertyIds: [] },
      "dev-secret-change-me",
      { expiresIn: "1h" }
    );
    const res = await request(app)
      .get("/protected")
      .set("Authorization", `Bearer ${legacy}`);
    expect(res.status).toBe(200);
    expect(res.body.emailVerified).toBe(false);
  });

  it("generateToken with no opts defaults to authUser.emailVerified (false here)", () => {
    const tok = generateToken({ ...user, emailVerified: false });
    const decoded = jwt.decode(tok) as any;
    expect(decoded.emailVerified).toBe(false);
  });

  it("generateToken with no opts and authUser.emailVerified=true emits true", () => {
    const tok = generateToken({ ...user, emailVerified: true });
    const decoded = jwt.decode(tok) as any;
    expect(decoded.emailVerified).toBe(true);
  });
});
