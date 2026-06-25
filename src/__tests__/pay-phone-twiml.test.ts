/**
 * Tests for src/modules/pay-phone/routes.ts — the on-call DTMF payment routes
 * (Twilio <Pay> → Stripe Pay Connector). Verifies the <Pay> TwiML shape, the
 * DARK gate, the connector-name override, and the action-callback correlation.
 */
const mockQuery = jest.fn();
jest.mock("../config/database", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import express from "express";
import request from "supertest";
import payPhoneRouter from "../modules/pay-phone/routes";

function app() {
  const a = express();
  a.use("/api/pay", payPhoneRouter);
  return a;
}

const ENV = process.env.PAY_DTMF_ENABLED;
const CONN = process.env.PAY_STRIPE_CONNECTOR;

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.PAY_DTMF_ENABLED;
  delete process.env.PAY_STRIPE_CONNECTOR;
});
afterAll(() => {
  if (ENV === undefined) delete process.env.PAY_DTMF_ENABLED;
  else process.env.PAY_DTMF_ENABLED = ENV;
  if (CONN === undefined) delete process.env.PAY_STRIPE_CONNECTOR;
  else process.env.PAY_STRIPE_CONNECTOR = CONN;
});

describe("pay-phone /twiml", () => {
  it("emits a $35.95 <Pay> verb bound to the Stripe connector when enabled", async () => {
    process.env.PAY_DTMF_ENABLED = "true";
    const res = await request(app()).post("/api/pay/twiml");
    expect(res.status).toBe(200);
    expect(res.type).toMatch(/xml/);
    expect(res.text).toContain("<Pay ");
    expect(res.text).toContain('paymentConnector="Stripe_Dev"');
    expect(res.text).toContain('chargeAmount="35.95"');
    expect(res.text).toContain('action="/api/pay/result"');
  });

  it("honors the PAY_STRIPE_CONNECTOR override (e.g. live instance)", async () => {
    process.env.PAY_DTMF_ENABLED = "true";
    process.env.PAY_STRIPE_CONNECTOR = "Stripe_Prod";
    const res = await request(app()).get("/api/pay/twiml");
    expect(res.status).toBe(200);
    expect(res.text).toContain('paymentConnector="Stripe_Prod"');
  });

  it("is DARK by default: no <Pay>, degrades to the link path", async () => {
    const res = await request(app()).post("/api/pay/twiml");
    expect(res.status).toBe(200);
    expect(res.text).not.toContain("<Pay ");
    expect(res.text).toContain("secure payment link");
    expect(res.text).toContain("<Hangup/>");
  });
});

describe("pay-phone /result", () => {
  it("correlates the caller by phone and acknowledges a successful charge", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "app-123" }] });
    const res = await request(app())
      .post("/api/pay/result")
      .type("form")
      .send({ Result: "success", From: "+17025551234", PaymentConfirmationCode: "ch_test_1" });

    expect(res.status).toBe(200);
    expect(res.text).toContain("application fee was received");
    // looked the application up by the caller's phone
    const call = mockQuery.mock.calls[0];
    expect(String(call[0])).toMatch(/FROM applications WHERE phone/i);
    expect(call[1]).toEqual(["+17025551234"]);
  });

  it("speaks a fallback (text the link) when the charge did not succeed", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app())
      .post("/api/pay/result")
      .type("form")
      .send({ Result: "payment-connector-error", From: "+17025550000" });

    expect(res.status).toBe(200);
    expect(res.text).toContain("weren't able to process");
  });
});
