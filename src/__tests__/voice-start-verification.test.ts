/**
 * Tests for src/modules/voice-intake/start-verification.ts — the Phase B
 * paid-conversion tool: records FCRA consent + opens a $35.95 Stripe Checkout
 * Session whose PaymentIntent is stamped type=application_fee.
 *
 * Handler is exercised in isolation (the dispatcher is covered separately).
 */

const mockQuery = jest.fn();
jest.mock("../config/database", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockIsConfigured = jest.fn();
const mockСheckoutCreate = jest.fn();
jest.mock("../lib/stripe", () => ({
  isStripeConfigured: () => mockIsConfigured(),
  getStripe: () => ({ checkout: { sessions: { create: (...a: unknown[]) => mockСheckoutCreate(...a) } } }),
}));

const mockRecordAuth = jest.fn();
jest.mock("../modules/screening/consumer-report-consent", () => ({
  recordAuthorization: (...a: unknown[]) => mockRecordAuth(...a),
  FCRA_DISCLOSURE_VERSION: "2026-06-01",
}));

const mockSendLink = jest.fn();
jest.mock("../modules/integrations/email", () => ({
  getEmailService: () => ({ sendVerificationFeeLink: (...a: unknown[]) => mockSendLink(...a) }),
}));

import {
  startVerificationHandler,
  registerStartVerificationHandler,
  __resetRegistrationForTests,
} from "../modules/voice-intake/start-verification";
import {
  clearToolHandlersForTests,
  getRegisteredToolNames,
} from "../modules/voice-intake/tool-callbacks";

const CTX = {
  agentId: "agent_test",
  conversationId: "conv_PB_1",
  toolCallId: "tc_PB_1",
  toolName: "start_verification" as const,
};
const APP_ID = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  jest.clearAllMocks();
  mockIsConfigured.mockReturnValue(true);
});

describe("startVerificationHandler", () => {
  it("returns ok:false when application_id is missing", async () => {
    const r = await startVerificationHandler({ consent_acknowledged: true }, CTX);
    expect(r.ok).toBe(false);
    expect(mockСheckoutCreate).not.toHaveBeenCalled();
  });

  it("returns ok:false when Stripe is not configured", async () => {
    mockIsConfigured.mockReturnValue(false);
    const r = await startVerificationHandler({ application_id: APP_ID, consent_acknowledged: true }, CTX);
    expect(r.ok).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns ok:false when the application is not found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const r = await startVerificationHandler({ application_id: APP_ID, consent_acknowledged: true }, CTX);
    expect(r.ok).toBe(false);
    expect(mockСheckoutCreate).not.toHaveBeenCalled();
  });

  it("records consent + creates a $35.95 application_fee checkout on the happy path", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: APP_ID, submitted_by: "user-1", status: "submitted" }] });
    mockСheckoutCreate.mockResolvedValueOnce({ id: "cs_1", url: "https://pay.stripe/cs_1", payment_intent: "pi_1" });

    const r = await startVerificationHandler({ application_id: APP_ID, consent_acknowledged: true }, CTX);

    expect(r.ok).toBe(true);
    expect(r.result?.checkout_url).toBe("https://pay.stripe/cs_1");
    expect(r.result?.amount).toBe("$35.95");
    // consent recorded
    expect(mockRecordAuth).toHaveBeenCalledTimes(1);
    // fee stamped on the PaymentIntent metadata for the webhook to route
    const arg = mockСheckoutCreate.mock.calls[0][0] as any;
    expect(arg.payment_intent_data.metadata.type).toBe("application_fee");
    expect(arg.payment_intent_data.metadata.applicationId).toBe(APP_ID);
    expect(arg.line_items[0].price_data.unit_amount).toBe(3595);
  });

  it("does NOT record consent when consent_acknowledged is false (screening will hold)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: APP_ID, submitted_by: "user-1", status: "submitted" }] });
    mockСheckoutCreate.mockResolvedValueOnce({ id: "cs_2", url: "https://pay.stripe/cs_2", payment_intent: "pi_2" });

    const r = await startVerificationHandler({ application_id: APP_ID, consent_acknowledged: false }, CTX);

    expect(r.ok).toBe(true);
    expect(mockRecordAuth).not.toHaveBeenCalled();
  });

  it("captures the email Frank provides at the fee step — persists it + emails the link", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: APP_ID, submitted_by: "user-1", status: "submitted", email: "voice+abc@voice-handoff.invalid", first_name: "Jordan" }],
      })
      .mockResolvedValueOnce({ rows: [] }); // the UPDATE applications SET email
    mockСheckoutCreate.mockResolvedValueOnce({ id: "cs_3", url: "https://pay.stripe/cs_3", payment_intent: "pi_3" });
    mockSendLink.mockResolvedValueOnce({ sent: true });

    const r = await startVerificationHandler(
      { application_id: APP_ID, consent_acknowledged: true, email: "jordan.banks@example.com" },
      CTX
    );

    expect(r.ok).toBe(true);
    expect(r.result?.emailed).toBe(true);
    // provided email persisted onto the application (the gap that left the link homeless)
    const updateCall = mockQuery.mock.calls.find((c) => String(c[0]).includes("UPDATE applications SET email"));
    expect(updateCall).toBeTruthy();
    expect(updateCall?.[1]).toContain("jordan.banks@example.com");
    // link sent to the provided address, and Frank only NOW claims he emailed it
    expect(mockSendLink).toHaveBeenCalledWith("jordan.banks@example.com", "https://pay.stripe/cs_3", { firstName: "Jordan" });
    expect(r.message).toContain("emailed you");
  });

  it("registers the start_verification handler", () => {
    clearToolHandlersForTests();
    __resetRegistrationForTests();
    registerStartVerificationHandler();
    expect(getRegisteredToolNames()).toContain("start_verification");
  });
});
