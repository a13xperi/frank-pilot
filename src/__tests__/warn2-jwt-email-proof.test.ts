/**
 * WARN #2 + W6 — original attack rendered harmless (defence-in-depth).
 *
 * Attack vector (pre-fix):
 *   1. Attacker POSTs /applicants/register with {email: "victim@x"}.
 *   2. Server returned a JWT bound to victim's email.
 *   3. Attacker used that JWT to call /apply or /me/applications and exfiltrated
 *      PII — without ever clicking the magic link.
 *
 * W6 closes the root cause: /register no longer returns a token or user at all.
 * WARN #2 remains as second-layer defence: even if an attacker somehow obtained
 * an unverified JWT (e.g. via a different path), /apply and /me/applications are
 * gated by requireEmailVerified and return 403 EMAIL_UNVERIFIED.
 */
import express from "express";
import request from "supertest";
import { generateToken, AuthUser } from "../middleware/auth";

jest.mock("../config/database", () => ({ query: jest.fn(), transaction: jest.fn() }));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockCreate = jest.fn();
jest.mock("../modules/application/service", () => ({
  ApplicationService: jest.fn().mockImplementation(() => ({ create: mockCreate })),
}));

const mockCreateMagicLink = jest.fn();
const mockLogMagicLink = jest.fn();
jest.mock("../modules/auth/magic-link-service", () => ({
  createMagicLink: mockCreateMagicLink,
  logMagicLink: mockLogMagicLink,
}));

import { query } from "../config/database";
import applicantsRouter from "../modules/applicants/routes";

const mockQuery = query as jest.MockedFunction<typeof query>;

const app = express();
app.use(express.json());
app.use("/applicants", applicantsRouter);

function mockUsersRow(
  partial: { id: string; email: string; role: string },
  emailVerifiedAt: Date | null
) {
  mockQuery.mockResolvedValueOnce({
    rows: [
      {
        id: partial.id,
        email: partial.email,
        role: partial.role,
        first_name: "X",
        last_name: "X",
        property_ids: [],
        is_active: true,
        email_verified_at: emailVerifiedAt,
      },
    ],
  } as any);
}

describe("WARN #2 + W6: /register exposes no token; unverified JWT is rejected on PII routes", () => {
  beforeEach(() => jest.clearAllMocks());

  it("W6: /register returns no token for a new account — attacker has nothing to replay", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);                      // SELECT users (none)
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "victim-001" }] } as any); // INSERT users
    mockCreateMagicLink.mockResolvedValueOnce({ link: "http://x/auth/callback?token=raw", userId: "victim-001" });

    const reg = await request(app)
      .post("/applicants/register")
      .send({ email: "victim@x.com", firstName: "V", lastName: "T" });

    expect(reg.status).toBe(202);
    // W6: no token in response — the attacker cannot craft a replay attack.
    expect(reg.body).not.toHaveProperty("token");
    expect(reg.body).not.toHaveProperty("user");
  });

  it("W2 defence-in-depth: a forged unverified JWT is rejected by /apply", async () => {
    // Even if an attacker somehow constructs an unverified JWT (not via /register),
    // the requireEmailVerified gate must block /apply.
    mockUsersRow({ id: "victim-001", email: "victim@x.com", role: "applicant" }, null);

    const forgedToken = generateToken(
      {
        id: "victim-001",
        email: "victim@x.com",
        role: "applicant",
        firstName: "V",
        lastName: "T",
        propertyIds: [],
        emailVerified: false,
      },
      { emailVerified: false }
    );

    const apply = await request(app)
      .post("/applicants/apply")
      .set("Authorization", `Bearer ${forgedToken}`)
      .send({
        propertyId: "550e8400-e29b-41d4-a716-446655440000",
        firstName: "Attack",
        lastName: "Er",
        ssn: "999-99-9999",
        dateOfBirth: "1990-01-01",
      });

    expect(apply.status).toBe(403);
    expect(apply.body.code).toBe("EMAIL_UNVERIFIED");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("attacker cannot read /me/applications with the returned token", async () => {
    mockUsersRow({ id: "victim-002", email: "v2@x.com", role: "applicant" }, null);
    const token = generateToken(
      {
        id: "victim-002",
        email: "v2@x.com",
        role: "applicant",
        firstName: "V",
        lastName: "T",
        propertyIds: [],
        emailVerified: false,
      },
      { emailVerified: false }
    );
    const res = await request(app)
      .get("/applicants/me/applications")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("EMAIL_UNVERIFIED");
  });

  it("staff roles bypass requireEmailVerified (here: leasing_agent calling /apply)", async () => {
    mockUsersRow({ id: "staff-001", email: "agent@co.com", role: "leasing_agent" }, null);
    mockCreate.mockResolvedValueOnce({ id: "app-staff", status: "draft", created_at: new Date() });
    mockQuery.mockResolvedValueOnce({ rows: [] } as any); // user_applications INSERT

    const staff: AuthUser = {
      id: "staff-001",
      email: "agent@co.com",
      role: "leasing_agent",
      firstName: "S",
      lastName: "T",
      propertyIds: ["prop-1"],
      emailVerified: false, // even with email_verified_at null in DB, staff bypass
    };
    const token = generateToken(staff, { emailVerified: false });

    const res = await request(app)
      .post("/applicants/apply")
      .set("Authorization", `Bearer ${token}`)
      .send({
        propertyId: "550e8400-e29b-41d4-a716-446655440000",
        firstName: "Real",
        lastName: "Applicant",
        ssn: "111-22-3333",
        dateOfBirth: "1990-01-01",
      });

    // Route's own role guard (line ~124): only applicant/tenant pass. So staff
    // get a 403 from the in-route role check, NOT from requireEmailVerified.
    // Distinguish: error message is "Applicant role required", NOT
    // "Email verification required", and no EMAIL_UNVERIFIED code.
    expect(res.status).toBe(403);
    expect(res.body.code).toBeUndefined();
    expect(res.body.error).toMatch(/applicant role required/i);
  });
});
