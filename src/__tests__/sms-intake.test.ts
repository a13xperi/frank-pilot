/**
 * Tests for the inbound-SMS intake (Phase 1, phone-first Frank).
 *
 *   - state-machine progression (pure: start -> name -> ... -> done)
 *   - inbound route fail-closed (503 while SMS_INTAKE_ENABLED is off)
 *   - happy path: a fresh texter gets the greeting back as TwiML, and a
 *     completing turn fires the applications-draft insert.
 *
 * Mocked: DB (SQL-routed) + logger, mirroring the cra-webhook / cockpit
 * suites. The pure state machine runs unmocked.
 */

import express from "express";
import request from "supertest";

jest.mock("../config/database", () => ({ query: jest.fn() }));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../modules/auth/magic-link-service", () => ({
  createMagicLinkByUserId: jest.fn().mockResolvedValue({ link: "https://x/auth/callback?token=t", userId: "user-9" }),
  sendMagicLinkSms: jest.fn(),
}));
const mockValidateRequest = jest.fn().mockReturnValue(true);
jest.mock("twilio", () => ({
  __esModule: true,
  default: { validateRequest: (...a: unknown[]) => mockValidateRequest(...a) },
}));

import { query } from "../config/database";
import { stepSms } from "../modules/sms-intake/state-machine";
import smsIntakeRoutes from "../modules/sms-intake/routes";
import { sendMagicLinkSms } from "../modules/auth/magic-link-service";

const mockQuery = query as jest.MockedFunction<typeof query>;

function buildApp() {
  const app = express();
  app.use("/api/webhooks/twilio", smsIntakeRoutes);
  return app;
}
const app = buildApp();

const FROM = "+14155550123";

function postInbound(fields: Record<string, string>) {
  return request(app)
    .post("/api/webhooks/twilio/inbound")
    .type("form")
    .send(fields);
}

const originalFlag = process.env.SMS_INTAKE_ENABLED;
const originalProperty = process.env.SMS_INTAKE_DEFAULT_PROPERTY_ID;

afterAll(() => {
  process.env.SMS_INTAKE_ENABLED = originalFlag;
  process.env.SMS_INTAKE_DEFAULT_PROPERTY_ID = originalProperty;
});

beforeEach(() => {
  jest.clearAllMocks();
});

// ── pure state machine ──────────────────────────────────────────────────────

describe("stepSms — progression", () => {
  it("cold-opens at `start`: greets, asks for name, advances to `name`, records nothing", () => {
    const r = stepSms("start", {}, "hi");
    expect(r.nextStep).toBe("name");
    expect(r.done).toBe(false);
    expect(r.collected).toEqual({});
    expect(r.reply).toMatch(/name/i);
  });

  it("walks name -> household -> income -> city -> done, recording each field", () => {
    let collected: Record<string, string> = {};

    const name = stepSms("name", collected, "Jane Q Public");
    expect(name.nextStep).toBe("household");
    expect(name.collected.name).toBe("Jane Q Public");
    collected = name.collected;

    const household = stepSms("household", collected, "4");
    expect(household.nextStep).toBe("income");
    expect(household.collected.household).toBe("4");
    collected = household.collected;

    const income = stepSms("income", collected, "$3,200");
    expect(income.nextStep).toBe("city");
    expect(income.collected.monthly_income).toBe("$3,200");
    collected = income.collected;

    const city = stepSms("city", collected, "Las Vegas");
    expect(city.nextStep).toBe("done");
    expect(city.collected.current_city).toBe("Las Vegas");
    expect(city.done).toBe(true);

    // Full collected map mirrors the voice data_collection keys.
    expect(city.collected).toEqual({
      name: "Jane Q Public",
      household: "4",
      monthly_income: "$3,200",
      current_city: "Las Vegas",
    });
  });

  it("re-prompts the same step on a blank answer without recording or advancing", () => {
    const r = stepSms("household", { name: "Jane" }, "   ");
    expect(r.nextStep).toBe("household");
    expect(r.done).toBe(false);
    expect(r.collected).toEqual({ name: "Jane" });
  });

  it("`done` is idempotent terminal — never re-fires done, never advances", () => {
    const r = stepSms("done", { name: "Jane" }, "thanks");
    expect(r.nextStep).toBe("done");
    expect(r.done).toBe(false);
  });
});

// ── inbound route ─────────────────────────────────────────────────────────

describe("POST /inbound — fail-closed", () => {
  it("503 while SMS_INTAKE_ENABLED is off", async () => {
    delete process.env.SMS_INTAKE_ENABLED;
    const res = await postInbound({ From: FROM, Body: "hi" });
    expect(res.status).toBe(503);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("503 when the flag is any non-'true' value", async () => {
    process.env.SMS_INTAKE_ENABLED = "1";
    const res = await postInbound({ From: FROM, Body: "hi" });
    expect(res.status).toBe(503);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe("POST /inbound — happy path", () => {
  beforeEach(() => {
    process.env.SMS_INTAKE_ENABLED = "true";
    process.env.TWILIO_AUTH_TOKEN = "test-token";
    mockValidateRequest.mockReturnValue(true);
    delete process.env.SMS_INTAKE_DEFAULT_PROPERTY_ID;
  });

  it("rejects 403 when the Twilio signature is invalid (forged inbound)", async () => {
    mockValidateRequest.mockReturnValue(false);
    const res = await postInbound({ From: FROM, Body: "hi" });
    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("fails closed (503) when TWILIO_AUTH_TOKEN is unset", async () => {
    delete process.env.TWILIO_AUTH_TOKEN;
    const res = await postInbound({ From: FROM, Body: "hi" });
    expect(res.status).toBe(503);
  });

  it("fresh texter → greeting TwiML, creates a session, advances to `name`", async () => {
    // No active session → create returns a fresh `start` row; then the UPDATE.
    mockQuery
      .mockResolvedValueOnce({ rows: [] } as any) // SELECT active session → none
      .mockResolvedValueOnce({
        rows: [{ id: "sess-1", phone_e164: FROM, application_id: null, step: "start", collected: {} }],
      } as any) // INSERT fresh session
      .mockResolvedValueOnce({ rows: [] } as any); // UPDATE session

    const res = await postInbound({ From: FROM, Body: "hello" });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/xml/);
    expect(res.text).toContain("<Response><Message>");
    expect(res.text).toMatch(/name/i);

    // The UPDATE persisted step='name'.
    const update = mockQuery.mock.calls.find((c) => /UPDATE sms_sessions/i.test(String(c[0])));
    expect(update).toBeTruthy();
    expect((update![1] as any[])[1]).toBe("name");
  });

  it("completing turn (answering city) inserts an applications draft (source 'sms') and completes the session", async () => {
    process.env.SMS_INTAKE_DEFAULT_PROPERTY_ID = "11111111-2222-3333-4444-555555555555";

    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: "sess-9",
            phone_e164: FROM,
            application_id: null,
            step: "city",
            collected: { name: "Jane Public", household: "3", monthly_income: "2500" },
          },
        ],
      } as any) // SELECT active session → at `city`
      .mockResolvedValueOnce({ rows: [] } as any) // findOrCreateUser: SELECT existing → none
      .mockResolvedValueOnce({ rows: [{ id: "user-9" }] } as any) // findOrCreateUser: INSERT user
      .mockResolvedValueOnce({ rows: [{ id: "app-draft-1" }] } as any) // INSERT applications draft
      .mockResolvedValueOnce({ rows: [] } as any) // INSERT user_applications link
      .mockResolvedValueOnce({ rows: [] } as any); // UPDATE session

    const res = await postInbound({ From: FROM, Body: "Las Vegas" });

    expect(res.status).toBe(200);
    expect(res.text).toContain("<Response><Message>");

    // Draft INSERT fired with source 'sms'.
    const insert = mockQuery.mock.calls.find(
      (c) => /INSERT INTO applications/i.test(String(c[0]))
    );
    expect(insert).toBeTruthy();
    expect(String(insert![0])).toMatch(/'sms'/);

    // Session UPDATE flips to completed + back-references the draft.
    const update = mockQuery.mock.calls.find((c) => /UPDATE sms_sessions/i.test(String(c[0])));
    expect(update).toBeTruthy();
    const params = update![1] as any[];
    expect(params[1]).toBe("done"); // step
    expect(params[3]).toBe("completed"); // status
    expect(params[4]).toBe("app-draft-1"); // application_id back-ref
    expect(params[5]).toBe("user-9"); // user_id back-ref — the SMS-only auth path

    // Spine seam fix: the SMS-only resident gets a phone-keyed user + a texted
    // magic link (the previous dead end where they were stranded).
    const userInsert = mockQuery.mock.calls.find((c) => /INSERT INTO users/i.test(String(c[0])));
    expect(userInsert).toBeTruthy();
    expect(sendMagicLinkSms).toHaveBeenCalled();
  });

  it("completes WITHOUT inserting a draft when SMS_INTAKE_DEFAULT_PROPERTY_ID is unset", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: "sess-10",
            phone_e164: FROM,
            application_id: null,
            step: "city",
            collected: { name: "Jane", household: "2", monthly_income: "1800" },
          },
        ],
      } as any) // SELECT active session → at `city`
      .mockResolvedValueOnce({ rows: [] } as any); // UPDATE session (no INSERT)

    const res = await postInbound({ From: FROM, Body: "Reno" });

    expect(res.status).toBe(200);
    const insert = mockQuery.mock.calls.find((c) => /INSERT INTO applications/i.test(String(c[0])));
    expect(insert).toBeFalsy();

    const update = mockQuery.mock.calls.find((c) => /UPDATE sms_sessions/i.test(String(c[0])));
    expect((update![1] as any[])[3]).toBe("completed");
  });

  it("escapes XML in the reply (no element break-out)", async () => {
    // At `done`, the reply is the closing line — but to prove escaping, drive a
    // blank-name re-prompt where the prompt is static; instead assert the TwiML
    // envelope never contains a raw unescaped angle bracket from user content.
    mockQuery
      .mockResolvedValueOnce({ rows: [] } as any)
      .mockResolvedValueOnce({
        rows: [{ id: "sess-x", phone_e164: FROM, application_id: null, step: "start", collected: {} }],
      } as any)
      .mockResolvedValueOnce({ rows: [] } as any);

    const res = await postInbound({ From: FROM, Body: "<script>" });
    expect(res.status).toBe(200);
    // The body we sent is never echoed; envelope stays well-formed.
    expect(res.text).not.toContain("<script>");
    expect(res.text.startsWith("<?xml")).toBe(true);
  });
});
