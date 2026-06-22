/**
 * Tests for src/modules/voice-verification/tool-handlers.ts — the two Phase 2
 * in-call tool handlers (send_verification, get_caller_history).
 *
 * Twilio, the magic-link service, and the verification SERVICE are all mocked,
 * so no real SMS, no real DB, no real link mint. We assert:
 *   - the flag gate: both handlers fail closed when VOICE_VERIFICATION_ENABLED
 *     is not "true" (no Twilio, no service call)
 *   - send_verification return shape: { ok, result: { sent, code, to, link } }
 *     (the exact shape the switchboard sim scenarios mock against)
 *   - get_caller_history return shape: { ok, result: { found, verified,
 *     last_contact, summary } }
 *   - idempotent registration
 */

const mockSendSMS = jest.fn().mockResolvedValue({ sent: true, messageId: "SM1" });
jest.mock("../modules/integrations/twilio", () => ({
  TwilioService: jest.fn().mockImplementation(() => ({
    sendSMS: (...args: unknown[]) => mockSendSMS(...args),
  })),
}));

const mockCreateMagicLink = jest.fn();
const mockLogMagicLink = jest.fn();
jest.mock("../modules/auth/magic-link-service", () => ({
  createMagicLink: (...args: unknown[]) => mockCreateMagicLink(...args),
  logMagicLink: (...args: unknown[]) => mockLogMagicLink(...args),
}));

jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockIssueCode = jest.fn();
const mockIsConversationVerified = jest.fn();
const mockResolveApplicant = jest.fn();
const mockSummarizeHistory = jest.fn();
jest.mock("../modules/voice-verification/service", () => ({
  issueCode: (...args: unknown[]) => mockIssueCode(...args),
  isConversationVerified: (...args: unknown[]) => mockIsConversationVerified(...args),
  resolveApplicant: (...args: unknown[]) => mockResolveApplicant(...args),
  summarizeHistory: (...args: unknown[]) => mockSummarizeHistory(...args),
  // maskPhone is pure — use the real impl so the masked `to` looks right.
  maskPhone: jest.requireActual("../modules/voice-verification/service").maskPhone,
}));

// normalizePhone (from voice-intake/service) is the real pure impl — no mock.

import {
  sendVerificationHandler,
  getCallerHistoryHandler,
  registerVoiceVerificationHandlers,
  __resetRegistrationForTests,
} from "../modules/voice-verification/tool-handlers";
import {
  clearToolHandlersForTests,
  getRegisteredToolNames,
} from "../modules/voice-intake/tool-callbacks";

const CTX = {
  agentId: "agent_test",
  conversationId: "conv_TEST_v2",
  toolCallId: "tc_TEST_v2",
  toolName: "send_verification" as const,
};

const ORIGINAL_FLAG = process.env.VOICE_VERIFICATION_ENABLED;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.VOICE_VERIFICATION_ENABLED = "true";
  mockIssueCode.mockResolvedValue({ code: "4729", id: "vvc-1" });
  mockResolveApplicant.mockResolvedValue({
    id: "app-1",
    status: "submitted",
    email: "marcus@x.test",
  });
  mockCreateMagicLink.mockResolvedValue({
    link: "https://portal.example/auth/callback?token=ABC",
    userId: "user-1",
  });
  mockIsConversationVerified.mockResolvedValue(true);
  mockSummarizeHistory.mockResolvedValue({
    found: true,
    lastContact: "2026-06-10",
    summary: "We last spoke on 2026-06-10.",
  });
});

afterAll(() => {
  if (ORIGINAL_FLAG === undefined) delete process.env.VOICE_VERIFICATION_ENABLED;
  else process.env.VOICE_VERIFICATION_ENABLED = ORIGINAL_FLAG;
});

describe("send_verification — flag gate", () => {
  it("fails closed when VOICE_VERIFICATION_ENABLED is not 'true'", async () => {
    delete process.env.VOICE_VERIFICATION_ENABLED;
    const res = await sendVerificationHandler({ phone: "+17025554651" }, CTX);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/disabled/i);
    expect(mockSendSMS).not.toHaveBeenCalled();
    expect(mockIssueCode).not.toHaveBeenCalled();
  });
});

describe("send_verification — happy path", () => {
  it("mints a code, texts a link + code, returns the pinned result shape", async () => {
    const res = await sendVerificationHandler({ phone: "+17025554651" }, CTX);

    expect(res.ok).toBe(true);
    expect(res.result).toEqual({
      sent: true,
      code: "4729",
      to: "***4651", // masked
      link: "https://portal.example/auth/callback?token=ABC",
    });

    // SMS body matches the product-design template.
    expect(mockSendSMS).toHaveBeenCalledTimes(1);
    const [to, body] = mockSendSMS.mock.calls[0];
    expect(to).toBe("+17025554651"); // full E.164 to Twilio
    expect(body).toContain("It's Frank. Here's your private link, tap anytime:");
    expect(body).toContain("https://portal.example/auth/callback?token=ABC");
    expect(body).toContain("Your code is 4729.");

    // code stored server-side too (issueCode called with the resolved applicant)
    expect(mockIssueCode).toHaveBeenCalledWith({
      conversationId: "conv_TEST_v2",
      phone: "+17025554651",
      applicantId: "app-1",
    });
    // link minted via the EXISTING magic-link service, keyed on resolved email
    expect(mockCreateMagicLink).toHaveBeenCalledWith("marcus@x.test");
  });

  it("normalizes a bare 10-digit caller_id and still verifies code-only when no link", async () => {
    mockResolveApplicant.mockResolvedValue(null); // unknown caller
    mockCreateMagicLink.mockResolvedValue(null);

    const res = await sendVerificationHandler({ caller_id: "7025554651" }, CTX);

    expect(res.ok).toBe(true);
    expect(res.result).toMatchObject({ sent: true, code: "4729", to: "***4651", link: "" });
    // issueCode got the normalized E.164 + null applicant
    expect(mockIssueCode).toHaveBeenCalledWith({
      conversationId: "conv_TEST_v2",
      phone: "+17025554651",
      applicantId: null,
    });
    // code-only SMS (no link)
    const [, body] = mockSendSMS.mock.calls[0];
    expect(body).toContain("verification code is 4729");
    expect(body).not.toContain("private link");
  });

  it("returns ok:false and never texts when no phone is resolvable", async () => {
    const res = await sendVerificationHandler({}, CTX);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/phone|number/i);
    expect(mockSendSMS).not.toHaveBeenCalled();
    expect(mockIssueCode).not.toHaveBeenCalled();
  });
});

describe("get_caller_history — flag gate + shape", () => {
  it("fails closed when the flag is off", async () => {
    delete process.env.VOICE_VERIFICATION_ENABLED;
    const res = await getCallerHistoryHandler({ phone: "+17025554651" }, CTX);
    expect(res.ok).toBe(false);
    expect(mockResolveApplicant).not.toHaveBeenCalled();
  });

  it("returns the pinned shape with verified + summary for a known caller", async () => {
    const res = await getCallerHistoryHandler({ phone: "+17025554651" }, CTX);
    expect(res.ok).toBe(true);
    expect(res.result).toEqual({
      found: true,
      verified: true,
      last_contact: "2026-06-10",
      summary: "We last spoke on 2026-06-10.",
    });
  });

  it("found:false (still verified-aware) when no applicant resolves", async () => {
    mockResolveApplicant.mockResolvedValue(null);
    mockIsConversationVerified.mockResolvedValue(false);

    const res = await getCallerHistoryHandler({ phone: "+10000000000" }, CTX);
    expect(res.ok).toBe(true);
    expect(res.result).toMatchObject({ found: false, verified: false, last_contact: null });
    expect(mockSummarizeHistory).not.toHaveBeenCalled();
  });

  it("reflects an UNVERIFIED conversation in the verified flag (defense-in-depth)", async () => {
    mockIsConversationVerified.mockResolvedValue(false);
    const res = await getCallerHistoryHandler({ applicant_id: "app-1" }, CTX);
    expect(res.result).toMatchObject({ verified: false });
  });
});

describe("registerVoiceVerificationHandlers", () => {
  beforeEach(() => {
    clearToolHandlersForTests();
    __resetRegistrationForTests();
  });

  it("registers both handlers", () => {
    registerVoiceVerificationHandlers();
    const names = getRegisteredToolNames();
    expect(names).toContain("send_verification");
    expect(names).toContain("get_caller_history");
  });

  it("is idempotent across repeated calls", () => {
    registerVoiceVerificationHandlers();
    registerVoiceVerificationHandlers();
    const names = getRegisteredToolNames();
    expect(names.filter((n) => n === "send_verification")).toHaveLength(1);
    expect(names.filter((n) => n === "get_caller_history")).toHaveLength(1);
  });
});
