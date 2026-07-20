/**
 * POST /applicants/register — SMS channel wiring.
 *
 * Locks that the `channel` body field threads through to sendMagicLink with
 * { firstName, channel, userId } and that the 202 + uniform payload are
 * preserved regardless of channel (the SMS transport is fire-and-forget inside
 * sendMagicLink, so it can never change the response — proven at the service
 * layer in magic-link-sms-service.test.ts).
 *
 * Mirrors applicants-routes-email-send.test.ts: the magic-link-service is
 * mocked so we assert on how /register calls it.
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
const LINK = "http://portal/auth/callback?token=raw-token";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/applicants", applicantsRouter);
  return app;
}
const app = buildApp();

describe("POST /applicants/register — SMS channel wiring", () => {
  beforeEach(() => jest.clearAllMocks());

  it("channel 'sms' threads through to sendMagicLink with { channel, userId } and returns 202", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any); // SELECT users → new
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "new-1" }] } as any); // INSERT
    mockCreateMagicLink.mockResolvedValueOnce({ link: LINK, userId: "new-1" });

    const res = await request(app).post("/applicants/register").send({
      email: "new@example.com",
      firstName: "Nora",
      lastName: "New",
      phone: "+17025551234",
      channel: "sms",
    });

    expect(res.status).toBe(202);
    expect(mockSendMagicLink).toHaveBeenCalledTimes(1);
    expect(mockSendMagicLink).toHaveBeenCalledWith("new@example.com", LINK, {
      firstName: "Nora",
      channel: "sms",
      userId: "new-1",
    });
  });

  it("channel 'both' threads through to sendMagicLink with channel 'both'", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: "existing-1", role: "applicant", is_active: true }],
    } as any);
    mockCreateMagicLink.mockResolvedValueOnce({ link: LINK, userId: "existing-1" });

    const res = await request(app).post("/applicants/register").send({
      email: "existing@example.com",
      firstName: "Eve",
      lastName: "Existing",
      channel: "both",
    });

    expect(res.status).toBe(202);
    expect(mockSendMagicLink).toHaveBeenCalledWith("existing@example.com", LINK, {
      firstName: "Eve",
      channel: "both",
      userId: "existing-1",
    });
  });

  it("default (no channel) calls sendMagicLink with channel 'email' (schema default)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "new-2" }] } as any);
    mockCreateMagicLink.mockResolvedValueOnce({ link: LINK, userId: "new-2" });

    const res = await request(app).post("/applicants/register").send({
      email: "default@example.com",
      firstName: "De",
      lastName: "Fault",
    });

    expect(res.status).toBe(202);
    // registerSchema.channel now .default("email"), so an omitted channel is
    // resolved to "email" BEFORE it reaches sendMagicLink — never undefined,
    // which sendMagicLink would otherwise fall through to its text-first "sms"
    // default and strand an email-only applicant with no phone.
    expect(mockSendMagicLink).toHaveBeenCalledWith("default@example.com", LINK, {
      firstName: "De",
      channel: "email",
      userId: "new-2",
    });
  });

  it("invalid channel value is rejected with 400 (no DB work, no send)", async () => {
    const res = await request(app).post("/applicants/register").send({
      email: "bad@example.com",
      firstName: "Bad",
      lastName: "Channel",
      channel: "carrier-pigeon",
    });

    expect(res.status).toBe(400);
    expect(mockSendMagicLink).not.toHaveBeenCalled();
  });
});
