/**
 * Tests for runFollowupTick — the Phase 2 callback dialer tick. Branches:
 * disabled (flag), outside window, empty queue, no consent (skip), dialed.
 */

const mockWindow = jest.fn();
jest.mock("../modules/outbound-validation/dialer", () => ({
  isWithinCallWindow: (...a: unknown[]) => mockWindow(...a),
}));
const mockClaim = jest.fn();
const mockMarkDialed = jest.fn();
const mockPacket = jest.fn();
jest.mock("../modules/follow-ups/service", () => ({
  claimNextDueFollowUp: (...a: unknown[]) => mockClaim(...a),
  markFollowUpDialed: (...a: unknown[]) => mockMarkDialed(...a),
  buildContextPacket: (...a: unknown[]) => mockPacket(...a),
}));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
const mockLedger = jest.fn();
jest.mock("../modules/relationship/ledger", () => ({
  recordLedgerEntry: (...a: unknown[]) => mockLedger(...a),
}));

import { runFollowupTick } from "../modules/follow-ups/dialer";

const CLAIMED = {
  id: "fu-1",
  phoneE164: "+17025551234",
  reason: "bad_time",
  attempts: 0,
  notes: null,
  checkpoint: "Stage: application; collected name+DOB; NEXT: employer + income docs",
  consentOutbound: true,
  voiceCallId: "conv_x",
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.FRANK_FOLLOWUP_ENABLED = "true";
  process.env.ELEVENLABS_API_KEY = "k";
  process.env.FRANK_FOLLOWUP_AGENT_ID = "agent_frank";
  process.env.FRANK_FOLLOWUP_PHONE_NUMBER_ID = "phnum_725";
  mockWindow.mockReturnValue(true);
});

describe("runFollowupTick", () => {
  it("disabled when the flag is off", async () => {
    process.env.FRANK_FOLLOWUP_ENABLED = "false";
    expect((await runFollowupTick()).action).toBe("disabled");
    expect(mockClaim).not.toHaveBeenCalled();
  });

  it("outside_window when not in the call window", async () => {
    mockWindow.mockReturnValue(false);
    expect((await runFollowupTick()).action).toBe("outside_window");
    expect(mockClaim).not.toHaveBeenCalled();
  });

  it("queue_empty when nothing is due", async () => {
    mockClaim.mockResolvedValueOnce(null);
    expect((await runFollowupTick()).action).toBe("queue_empty");
  });

  it("no_consent skips a claimed row without outbound consent", async () => {
    mockClaim.mockResolvedValueOnce({ ...CLAIMED, consentOutbound: false });
    const r = await runFollowupTick();
    expect(r.action).toBe("no_consent");
    expect(mockMarkDialed).toHaveBeenCalledWith("fu-1", null);
  });

  it("dials the callback with the context packet on the happy path", async () => {
    mockClaim.mockResolvedValueOnce(CLAIMED);
    mockPacket.mockResolvedValueOnce({ rapport: "Returning caller", application: { status: "draft" }, open_followups: [] });
    const fetchMock = jest
      .spyOn(global, "fetch" as never)
      .mockResolvedValue({ ok: true, json: async () => ({ conversation_id: "conv_cb" }) } as never);

    const r = await runFollowupTick();
    expect(r.action).toBe("dialed");
    expect((r as { conversationId: string }).conversationId).toBe("conv_cb");
    expect(mockMarkDialed).toHaveBeenCalledWith("fu-1", "conv_cb");
    // the callback + its reason are recorded on the person's ledger of truth
    expect(mockLedger).toHaveBeenCalledWith(
      expect.objectContaining({
        phoneE164: "+17025551234",
        eventType: "callback_placed",
        direction: "outbound",
        summary: expect.stringContaining("bad_time"),
        ref: "conv_cb",
      })
    );
    // dynamic vars carried the context packet
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.conversation_initiation_client_data.dynamic_variables.is_followup).toBe("true");
    expect(body.conversation_initiation_client_data.dynamic_variables.caller_rapport).toContain("Returning");
    // the callback resumes EXACTLY where the prior call left off
    expect(body.conversation_initiation_client_data.dynamic_variables.resume_checkpoint).toContain("employer");
    fetchMock.mockRestore();
  });
});
