/**
 * Tests for src/modules/voice-intake/take-payment.ts — phone (MOTO) collection
 * of the $35.95 fee: confirms a Stripe PaymentIntent stamped
 * type=application_fee so the same webhook runs submitted + screening.
 */

const mockQuery = jest.fn();
jest.mock("../config/database", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockIsConfigured = jest.fn();
const mockPiCreate = jest.fn();
jest.mock("../lib/stripe", () => ({
  isStripeConfigured: () => mockIsConfigured(),
  getStripe: () => ({ paymentIntents: { create: (...a: unknown[]) => mockPiCreate(...a) } }),
}));

const mockRecordAuth = jest.fn();
jest.mock("../modules/screening/consumer-report-consent", () => ({
  recordAuthorization: (...a: unknown[]) => mockRecordAuth(...a),
  FCRA_DISCLOSURE_VERSION: "2026-06-01",
}));

import {
  takePaymentHandler,
  registerTakePaymentHandler,
  __resetRegistrationForTests,
} from "../modules/voice-intake/take-payment";
import {
  clearToolHandlersForTests,
  getRegisteredToolNames,
} from "../modules/voice-intake/tool-callbacks";

const CTX = { agentId: "a", conversationId: "conv_pay", toolCallId: "tc", toolName: "take_payment" as const };
const APP_ID = "22222222-2222-2222-2222-222222222222";
const CARD = { card_number: "4242 4242 4242 4242", exp_month: 12, exp_year: 34, cvc: "123" };

beforeEach(() => {
  jest.clearAllMocks();
  mockIsConfigured.mockReturnValue(true);
});

describe("takePaymentHandler", () => {
  it("ok:false without application_id", async () => {
    const r = await takePaymentHandler({ ...CARD }, CTX);
    expect(r.ok).toBe(false);
    expect(mockPiCreate).not.toHaveBeenCalled();
  });

  it("ok:false when card details are incomplete", async () => {
    const r = await takePaymentHandler({ application_id: APP_ID, card_number: "4242" }, CTX);
    expect(r.ok).toBe(false);
    expect(mockPiCreate).not.toHaveBeenCalled();
  });

  it("ok:false when the application is not found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const r = await takePaymentHandler({ application_id: APP_ID, ...CARD, consent_acknowledged: true }, CTX);
    expect(r.ok).toBe(false);
    expect(mockPiCreate).not.toHaveBeenCalled();
  });

  it("charges the card MOTO + stamps application_fee, records consent, on success", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ submitted_by: "user-1", status: "draft" }] });
    mockPiCreate.mockResolvedValueOnce({ id: "pi_ok", status: "succeeded" });

    const r = await takePaymentHandler({ application_id: APP_ID, ...CARD, consent_acknowledged: true }, CTX);

    expect(r.ok).toBe(true);
    expect(r.result?.payment_intent_id).toBe("pi_ok");
    expect(mockRecordAuth).toHaveBeenCalledTimes(1);
    const arg = mockPiCreate.mock.calls[0][0] as any;
    expect(arg.amount).toBe(3595);
    expect(arg.confirm).toBe(true);
    expect(arg.payment_method_options).toBeUndefined(); // moto dropped (unknown param)
    expect(arg.metadata.type).toBe("application_fee");
    expect(arg.metadata.applicationId).toBe(APP_ID);
    // card normalized (spaces stripped, 2-digit year expanded)
    expect(arg.payment_method_data.card.number).toBe("4242424242424242");
    expect(arg.payment_method_data.card.exp_year).toBe(2034);
  });

  it("soft-fails when the charge throws (declined/mistyped)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ submitted_by: "user-1", status: "draft" }] });
    mockPiCreate.mockRejectedValueOnce(new Error("Your card was declined."));
    const r = await takePaymentHandler({ application_id: APP_ID, ...CARD, consent_acknowledged: true }, CTX);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/card/i);
  });

  it("soft-fails when the intent is not succeeded", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ submitted_by: "user-1", status: "draft" }] });
    mockPiCreate.mockResolvedValueOnce({ id: "pi_x", status: "requires_action" });
    const r = await takePaymentHandler({ application_id: APP_ID, ...CARD, consent_acknowledged: true }, CTX);
    expect(r.ok).toBe(false);
    expect(r.result?.status).toBe("requires_action");
  });

  it("registers the take_payment handler", () => {
    clearToolHandlersForTests();
    __resetRegistrationForTests();
    registerTakePaymentHandler();
    expect(getRegisteredToolNames()).toContain("take_payment");
  });
});
