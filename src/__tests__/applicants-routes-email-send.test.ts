/**
 * /register → magic-link email delivery wiring.
 *
 * Locks the contract that:
 *   1. New-applicant branch: createMagicLink returns a link → sendMagicLink
 *      is invoked with the user's email + the raw link.
 *   2. Existing-applicant branch: same — sendMagicLink fires.
 *   3. Staff branch: createMagicLink returns null → sendMagicLink does NOT
 *      fire (no email leaks to a staff address). The /register response is
 *      still uniform; only the side-effect differs.
 *
 * This is the wiring complement to email-service.test.ts (which locks the
 * Resend client shape) and applicants-routes-info1.test.ts (which locks the
 * wall-clock floor).
 */
import express from "express";
import request from "supertest";

jest.mock("../config/database", () => ({ query: jest.fn(), transaction: jest.fn() }));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockCreateMagicLink = jest.fn();
const mockLogMagicLink = jest.fn();
const mockSendMagicLink = jest.fn();
jest.mock("../modules/auth/magic-link-service", () => ({
  createMagicLink: mockCreateMagicLink,
  logMagicLink: mockLogMagicLink,
  sendMagicLink: mockSendMagicLink,
}));

import { query } from "../config/database";
import applicantsRouter from "../modules/applicants/routes";

const mockQuery = query as jest.MockedFunction<typeof query>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/applicants", applicantsRouter);
  return app;
}
const app = buildApp();

describe("POST /applicants/register — magic-link email delivery wiring", () => {
  beforeEach(() => jest.clearAllMocks());

  it("fires sendMagicLink with email + raw link on the new-applicant branch", async () => {
    // SELECT users → empty (new applicant).
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);
    // INSERT users RETURNING id.
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "new-1" }] } as any);
    mockCreateMagicLink.mockResolvedValueOnce({
      link: "http://portal/auth/callback?token=raw-1",
      userId: "new-1",
    });

    const res = await request(app)
      .post("/applicants/register")
      .send({ email: "new@example.com", firstName: "Nora", lastName: "New" });

    expect(res.status).toBe(202);
    expect(mockSendMagicLink).toHaveBeenCalledTimes(1);
    expect(mockSendMagicLink).toHaveBeenCalledWith(
      "new@example.com",
      "http://portal/auth/callback?token=raw-1",
      { firstName: "Nora" }
    );
  });

  it("fires sendMagicLink on the existing-applicant branch", async () => {
    // SELECT users → existing applicant.
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: "existing-1", role: "applicant", is_active: true }],
    } as any);
    mockCreateMagicLink.mockResolvedValueOnce({
      link: "http://portal/auth/callback?token=raw-2",
      userId: "existing-1",
    });

    const res = await request(app)
      .post("/applicants/register")
      .send({ email: "existing@example.com", firstName: "Eve", lastName: "Existing" });

    expect(res.status).toBe(202);
    expect(mockSendMagicLink).toHaveBeenCalledTimes(1);
    expect(mockSendMagicLink).toHaveBeenCalledWith(
      "existing@example.com",
      "http://portal/auth/callback?token=raw-2",
      { firstName: "Eve" }
    );
  });

  it("does NOT fire sendMagicLink on the staff branch (createMagicLink returns null)", async () => {
    // SELECT users → staff role; service short-circuits to null.
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: "staff-1", role: "leasing_agent", is_active: true }],
    } as any);
    mockCreateMagicLink.mockResolvedValueOnce(null);

    const res = await request(app)
      .post("/applicants/register")
      .send({ email: "staff@example.com", firstName: "Sam", lastName: "Staff" });

    expect(res.status).toBe(202);
    expect(mockSendMagicLink).not.toHaveBeenCalled();
    // Uniform response — staff path still looks identical to applicant paths.
    expect(res.body).toEqual(
      expect.objectContaining({ ok: true, message: expect.any(String) })
    );
  });
});
