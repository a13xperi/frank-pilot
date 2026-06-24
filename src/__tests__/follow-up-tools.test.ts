/**
 * Tests for the follow-up tools (schedule_followup / get_followups /
 * get_call_context) exercised through the real service with a mocked DB.
 */

const mockQuery = jest.fn();
jest.mock("../config/database", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../modules/voice-intake/service", () => ({
  normalizePhone: (p: unknown) => (typeof p === "string" && p.trim() ? p.trim() : null),
}));
const mockGetCallerHistory = jest.fn();
const mockBuildRapport = jest.fn();
jest.mock("../modules/caller-history/service", () => ({
  getCallerHistory: (...a: unknown[]) => mockGetCallerHistory(...a),
  buildRapportSummary: (...a: unknown[]) => mockBuildRapport(...a),
}));

import {
  scheduleFollowupHandler,
  getFollowupsHandler,
  getCallContextHandler,
  registerFollowUpHandlers,
  __resetRegistrationForTests,
} from "../modules/follow-ups/tools";
import {
  clearToolHandlersForTests,
  getRegisteredToolNames,
} from "../modules/voice-intake/tool-callbacks";

const CTX = { agentId: "a", conversationId: "conv_FU", toolCallId: "tc", toolName: "schedule_followup" as const };
const PHONE = "+17025551234";
const WHEN = "2026-06-26T21:00:00.000Z";

beforeEach(() => jest.clearAllMocks());

describe("schedule_followup", () => {
  it("ok:false when phone is missing", async () => {
    const r = await scheduleFollowupHandler({ scheduled_for_iso: WHEN }, CTX);
    expect(r.ok).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });
  it("ok:false when time is missing", async () => {
    const r = await scheduleFollowupHandler({ phone_e164: PHONE }, CTX);
    expect(r.ok).toBe(false);
  });
  it("creates a pending follow-up on the happy path", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: "fu-1", phone_e164: PHONE, reason: "bad_time", scheduled_for: WHEN, status: "pending", attempts: 0, notes: null }],
    });
    const r = await scheduleFollowupHandler({ phone_e164: PHONE, reason: "bad_time", scheduled_for_iso: WHEN }, CTX);
    expect(r.ok).toBe(true);
    expect(r.result?.followup_id).toBe("fu-1");
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("INSERT INTO follow_ups");
  });
});

describe("get_followups", () => {
  it("reports the open loop", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: "fu-1", phone_e164: PHONE, reason: "bad_time", scheduled_for: WHEN, status: "pending", attempts: 0, notes: null }],
    });
    const r = await getFollowupsHandler({ phone_e164: PHONE }, CTX);
    expect(r.ok).toBe(true);
    expect((r.result?.open_followups as unknown[]).length).toBe(1);
    expect(r.message).toContain("1 callback");
  });
});

describe("get_call_context", () => {
  it("assembles rapport + application + open follow-ups", async () => {
    mockGetCallerHistory.mockResolvedValueOnce({ callCount: 3 });
    mockBuildRapport.mockReturnValueOnce("Returning caller (3rd call); interested in 1BR");
    mockQuery
      .mockResolvedValueOnce({ rows: [{ status: "screening_passed", identity_verification_result: "pass", background_check_result: "pass", credit_check_result: "pass", compliance_check_result: "pass", income_verification_result: null }] }) // application
      .mockResolvedValueOnce({ rows: [] }); // open followups
    const r = await getCallContextHandler({ phone_e164: PHONE }, CTX);
    expect(r.ok).toBe(true);
    const p = r.result as any;
    expect(p.rapport).toContain("Returning caller");
    expect(p.application.status).toBe("screening_passed");
    expect(r.message).toContain("screening_passed");
  });
});

describe("registration", () => {
  it("registers all three follow-up tools", () => {
    clearToolHandlersForTests();
    __resetRegistrationForTests();
    registerFollowUpHandlers();
    const names = getRegisteredToolNames();
    expect(names).toEqual(expect.arrayContaining(["schedule_followup", "get_followups", "get_call_context"]));
  });
});
