/**
 * Tests for src/modules/voice-intake/send-app-link.ts — the Phase B in-call
 * tool handler that mid-call texts the caller a magic-link to the wizard.
 *
 * Scope:
 *   - Phone normalization happy/fail paths
 *   - Find-or-create: existing applicant by phone vs. fresh INSERT
 *   - Magic-link URL gets `&intake=<conversation_id>` appended
 *   - sendMagicLinkSms is fired with the user id + final link
 *   - createMagicLink failure surfaces as { ok: false } message, no SMS
 *
 * The dispatcher (tool-callbacks.ts) is already covered end-to-end in
 * voice-tool-callbacks.test.ts; here we exercise the handler function in
 * isolation by calling it directly. That keeps this suite fast and pinned
 * to the business logic.
 */

const mockQuery = jest.fn();
jest.mock("../config/database", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockCreateMagicLink = jest.fn();
const mockSendMagicLinkSms = jest.fn();
const mockLogMagicLink = jest.fn();
jest.mock("../modules/auth/magic-link-service", () => ({
  createMagicLink: (...args: unknown[]) => mockCreateMagicLink(...args),
  sendMagicLinkSms: (...args: unknown[]) => mockSendMagicLinkSms(...args),
  logMagicLink: (...args: unknown[]) => mockLogMagicLink(...args),
}));

import {
  sendAppLinkHandler,
  registerVoiceToolHandlers,
  __resetRegistrationForTests,
} from "../modules/voice-intake/send-app-link";
import {
  clearToolHandlersForTests,
  getRegisteredToolNames,
} from "../modules/voice-intake/tool-callbacks";

const CTX = {
  agentId: "agent_test",
  conversationId: "conv_TEST_xyz",
  toolCallId: "tc_TEST_1",
  toolName: "send_app_link" as const,
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("sendAppLinkHandler — phone parsing", () => {
  it("returns ok:false when phone is missing", async () => {
    const result = await sendAppLinkHandler({}, CTX);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/phone/i);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockCreateMagicLink).not.toHaveBeenCalled();
    expect(mockSendMagicLinkSms).not.toHaveBeenCalled();
  });

  it("returns ok:false when phone is empty string", async () => {
    const result = await sendAppLinkHandler({ phone: "   " }, CTX);
    expect(result.ok).toBe(false);
    expect(mockCreateMagicLink).not.toHaveBeenCalled();
  });

  it("returns ok:false when phone has no digits", async () => {
    const result = await sendAppLinkHandler({ phone: "abc-def" }, CTX);
    expect(result.ok).toBe(false);
    // No createMagicLink because normalizePhone returns "+" which we treat
    // as invalid here (handler checks for falsy).
    expect(mockCreateMagicLink).not.toHaveBeenCalled();
  });
});

describe("sendAppLinkHandler — happy path", () => {
  beforeEach(() => {
    mockCreateMagicLink.mockResolvedValue({
      link: "http://localhost:5174/auth/callback?token=ABC",
      userId: "user-uuid-1",
    });
  });

  it("re-uses an existing applicant by phone (no INSERT)", async () => {
    mockQuery
      // findOrCreateApplicant SELECT → existing user
      .mockResolvedValueOnce({
        rows: [{ id: "user-uuid-1", email: "existing@example.com" }],
      });

    const result = await sendAppLinkHandler(
      { phone: "+17025551212" },
      CTX
    );

    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/text|link/i);

    // Only the SELECT fired; no INSERT.
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][0]).toMatch(/SELECT id, email/);
    expect(mockQuery.mock.calls[0][1]).toEqual(["+17025551212"]);

    // Magic-link created for the existing email.
    expect(mockCreateMagicLink).toHaveBeenCalledWith("existing@example.com");

    // SMS fired with the magic-link userId, and the link has the intake
    // query appended.
    expect(mockSendMagicLinkSms).toHaveBeenCalledTimes(1);
    const [userIdArg, linkArg] = mockSendMagicLinkSms.mock.calls[0];
    expect(userIdArg).toBe("user-uuid-1");
    expect(linkArg).toBe(
      "http://localhost:5174/auth/callback?token=ABC&intake=conv_TEST_xyz"
    );

    // The same SMS carries a short onboarding-walkthrough line (default URL).
    const onboardingLine = mockSendMagicLinkSms.mock.calls[0][2] as string;
    expect(onboardingLine).toContain("https://frank-go.vercel.app/onboard");
    expect(onboardingLine).toMatch(/walkthrough/i);

    // logMagicLink fired with redact-friendly args.
    expect(mockLogMagicLink).toHaveBeenCalledWith("existing@example.com", linkArg);
  });

  it("honors the ONBOARDING_VIDEO_URL env override", async () => {
    const prev = process.env.ONBOARDING_VIDEO_URL;
    process.env.ONBOARDING_VIDEO_URL = "https://vid.example/onboard";
    let handler = sendAppLinkHandler;
    jest.isolateModules(() => {
      // Re-require so the module-load-time constant picks up the override.
      handler = require("../modules/voice-intake/send-app-link").sendAppLinkHandler;
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: "user-uuid-env", email: "env@example.com" }],
    });
    mockCreateMagicLink.mockResolvedValueOnce({
      link: "http://localhost:5174/auth/callback?token=ENV",
      userId: "user-uuid-env",
    });

    await handler({ phone: "+17025551212" }, CTX);

    const line = mockSendMagicLinkSms.mock.calls.at(-1)?.[2] as string;
    expect(line).toContain("https://vid.example/onboard");

    if (prev === undefined) delete process.env.ONBOARDING_VIDEO_URL;
    else process.env.ONBOARDING_VIDEO_URL = prev;
  });

  it("creates a new applicant when no user has this phone", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // SELECT → miss
      .mockResolvedValueOnce({
        rows: [
          { id: "user-uuid-2", email: "voice+conv_TEST_xyz@voice-handoff.invalid" },
        ],
      }); // INSERT → created

    mockCreateMagicLink.mockResolvedValueOnce({
      link: "http://localhost:5174/auth/callback?token=DEF",
      userId: "user-uuid-2",
    });

    const result = await sendAppLinkHandler(
      { phone: "+17025551212", first_name: "Alex", last_name: "Peri" },
      CTX
    );

    expect(result.ok).toBe(true);

    // INSERT carries the synthesized email + names + phone.
    const insertCall = mockQuery.mock.calls[1];
    expect(insertCall[0]).toMatch(/INSERT INTO users/);
    expect(insertCall[1]).toEqual([
      "voice+conv_TEST_xyz@voice-handoff.invalid",
      "Alex",
      "Peri",
      "+17025551212",
    ]);

    expect(mockCreateMagicLink).toHaveBeenCalledWith(
      "voice+conv_TEST_xyz@voice-handoff.invalid"
    );
    expect(mockSendMagicLinkSms).toHaveBeenCalledWith(
      "user-uuid-2",
      "http://localhost:5174/auth/callback?token=DEF&intake=conv_TEST_xyz",
      expect.stringContaining("https://frank-go.vercel.app/onboard")
    );
  });

  it("normalizes a 10-digit US phone to +1XXXXXXXXXX", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: "u1", email: "e@example.com" }],
    });

    await sendAppLinkHandler({ phone: "7025551212" }, CTX);

    expect(mockQuery.mock.calls[0][1]).toEqual(["+17025551212"]);
  });

  it("accepts camelCase firstName/lastName too", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "u3", email: "e@example.com" }] });

    await sendAppLinkHandler(
      { phone: "+17025551212", firstName: "Sam", lastName: "Reed" },
      CTX
    );

    const insertCall = mockQuery.mock.calls[1];
    expect(insertCall[1][1]).toBe("Sam");
    expect(insertCall[1][2]).toBe("Reed");
  });
});

describe("sendAppLinkHandler — failure paths", () => {
  it("returns ok:false and skips SMS when createMagicLink fails", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: "user-uuid-1", email: "u@example.com" }],
    });
    mockCreateMagicLink.mockResolvedValueOnce(null);

    const result = await sendAppLinkHandler({ phone: "+17025551212" }, CTX);

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/sorry|trouble|call back/i);
    expect(mockSendMagicLinkSms).not.toHaveBeenCalled();
  });
});

describe("registerVoiceToolHandlers", () => {
  beforeEach(() => {
    clearToolHandlersForTests();
    __resetRegistrationForTests();
  });

  it("registers the send_app_link handler once", () => {
    registerVoiceToolHandlers();
    expect(getRegisteredToolNames()).toContain("send_app_link");
  });

  it("is idempotent across repeated calls", () => {
    registerVoiceToolHandlers();
    registerVoiceToolHandlers();
    const names = getRegisteredToolNames();
    expect(names.filter((n) => n === "send_app_link")).toHaveLength(1);
  });
});
