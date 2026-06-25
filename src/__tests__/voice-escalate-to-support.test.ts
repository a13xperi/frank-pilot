/**
 * Tests for src/modules/voice-intake/escalation.ts — the `escalate_to_support`
 * in-call tool: the HUMAN fail-safe rung. Records a human-escalation follow-up
 * and returns a warm confirmation for Frank to read.
 *
 * createFollowUp is mocked (the follow_ups spine is covered by its own suite);
 * here we pin the handler's business logic in isolation.
 */

const mockCreateFollowUp = jest.fn();
jest.mock("../modules/follow-ups/service", () => ({
  createFollowUp: (...args: unknown[]) => mockCreateFollowUp(...args),
}));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import {
  escalateToSupportHandler,
  registerEscalationHandler,
  __resetRegistrationForTests,
} from "../modules/voice-intake/escalation";
import {
  clearToolHandlersForTests,
  getRegisteredToolNames,
} from "../modules/voice-intake/tool-callbacks";

const ctx = {
  agentId: "agent_x",
  conversationId: "conv_1",
  toolCallId: "tc_1",
  toolName: "escalate_to_support",
};

describe("escalate_to_support", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetRegistrationForTests();
    clearToolHandlersForTests();
  });

  it("records a human-escalation follow-up + returns a warm confirmation", async () => {
    mockCreateFollowUp.mockResolvedValueOnce({ id: "fu_1" });
    const r = await escalateToSupportHandler(
      { phone_e164: "+17025551234", reason: "stuck_after_retries" },
      ctx
    );
    expect(r.ok).toBe(true);
    expect(r.result?.escalated).toBe(true);
    expect(r.result?.follow_up_id).toBe("fu_1");
    expect(r.message).toMatch(/real person|call you back/i);

    const arg = mockCreateFollowUp.mock.calls[0][0];
    expect(arg.phoneE164).toBe("+17025551234");
    expect(arg.reason).toBe("callback_requested"); // valid follow_ups value
    expect(arg.consentOutbound).toBe(true); // caller asked → consent implied
    expect(arg.source).toBe("voice_intake_escalation");
    expect(arg.notes).toBe("human_escalation: stuck_after_retries");
    expect(arg.voiceCallId).toBe("conv_1");
  });

  it("missing phone → graceful ask, no follow-up written", async () => {
    const r = await escalateToSupportHandler({}, ctx);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/number/i);
    expect(mockCreateFollowUp).not.toHaveBeenCalled();
  });

  it("createFollowUp null → graceful error (no false promise)", async () => {
    mockCreateFollowUp.mockResolvedValueOnce(null);
    const r = await escalateToSupportHandler({ phone: "+17025551234" }, ctx);
    expect(r.ok).toBe(false);
  });

  it("coerces an unknown/free-text reason to a safe categorical (no PII leak)", async () => {
    mockCreateFollowUp.mockResolvedValueOnce({ id: "fu_2" });
    await escalateToSupportHandler(
      { phone: "+17025551234", reason: "my name is Jane Doe and I live at 5 Main" },
      ctx
    );
    expect(mockCreateFollowUp.mock.calls[0][0].notes).toBe(
      "human_escalation: caller_requested_human"
    );
  });

  it("registers the escalate_to_support tool name", () => {
    registerEscalationHandler();
    expect(getRegisteredToolNames()).toContain("escalate_to_support");
  });
});
