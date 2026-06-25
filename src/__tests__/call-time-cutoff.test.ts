/**
 * Tests for the call-time cutoff recovery:
 *   - schedule_followup with reason "time_cutoff" schedules an IMMEDIATE callback
 *     (no "what time works" needed — it continues the same call).
 *   - maybeCreateCutoffCallback (post-call safety net): flag-gated, fires only
 *     near the cap, dedups against an open loop.
 */

const mockQuery = jest.fn();
jest.mock("../config/database", () => ({ query: (...a: unknown[]) => mockQuery(...a) }));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../modules/voice-intake/service", () => ({
  normalizePhone: (p: unknown) => (typeof p === "string" && p.trim() ? p.trim() : null),
}));
jest.mock("../modules/caller-history/service", () => ({
  getCallerHistory: jest.fn(),
  buildRapportSummary: jest.fn(),
}));
jest.mock("../modules/relationship/ledger", () => ({ recordLedgerEntry: jest.fn() }));

import { scheduleFollowupHandler } from "../modules/follow-ups/tools";
import { maybeCreateCutoffCallback } from "../modules/follow-ups/service";

const CTX = { agentId: "a", conversationId: "conv_X", toolCallId: "tc", toolName: "schedule_followup" as const };
const PHONE = "+17025551234";
const ROW = { id: "fu-1", phone_e164: PHONE, reason: "time_cutoff", scheduled_for: "now", status: "pending", attempts: 0, notes: null, checkpoint: "cp" };

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.FRANK_CUTOFF_CALLBACK_ENABLED;
  delete process.env.FRANK_CALL_MAX_SECS;
});

describe("schedule_followup time_cutoff = immediate", () => {
  it("schedules now without requiring a time when reason is time_cutoff", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [ROW] }); // the INSERT
    const r = await scheduleFollowupHandler(
      { phone_e164: PHONE, reason: "time_cutoff", checkpoint: "mid-application, NEXT: income docs" },
      CTX
    );
    expect(r.ok).toBe(true);
    const sql = String(mockQuery.mock.calls[0][0]);
    expect(sql).toContain("INSERT INTO follow_ups");
    // the inserted scheduled_for is a real recent ISO (set to now, not the missing arg)
    const when = new Date(mockQuery.mock.calls[0][1][4] as string);
    expect(Number.isNaN(when.getTime())).toBe(false);
  });

  it("still requires a time for an ordinary callback_requested", async () => {
    const r = await scheduleFollowupHandler({ phone_e164: PHONE, reason: "callback_requested" }, CTX);
    expect(r.ok).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("schedules NOW when handed a past/garbage time (the 2025-date bug)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [ROW] });
    const r = await scheduleFollowupHandler(
      { phone_e164: PHONE, reason: "callback_requested", scheduled_for: "2025-06-23T03:44:00.000Z" },
      CTX
    );
    expect(r.ok).toBe(true);
    // the bad past time is discarded — scheduled ~now, not 2025
    const when = new Date(mockQuery.mock.calls[0][1][4] as string).getTime();
    expect(when).toBeGreaterThan(Date.now() - 5000);
  });

  it("keeps a valid near-future time as given", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [ROW] });
    const future = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(); // 2h out
    const r = await scheduleFollowupHandler(
      { phone_e164: PHONE, reason: "callback_requested", scheduled_for: future },
      CTX
    );
    expect(r.ok).toBe(true);
    expect(mockQuery.mock.calls[0][1][4]).toBe(future);
  });

  it("treats 'call me right back' as immediate (schedules now, no time needed)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [ROW] });
    const r = await scheduleFollowupHandler({ phone_e164: PHONE, reason: "call me right back" }, CTX);
    expect(r.ok).toBe(true);
    const when = new Date(mockQuery.mock.calls[0][1][4] as string).getTime();
    expect(when).toBeGreaterThan(Date.now() - 5000);
  });
});

describe("maybeCreateCutoffCallback (post-call safety net)", () => {
  it("no-op when the flag is off", async () => {
    const r = await maybeCreateCutoffCallback({ conversationId: "c", phoneE164: PHONE, durationSecs: 901 });
    expect(r).toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("no-op for a normal short call (below the cap floor)", async () => {
    process.env.FRANK_CUTOFF_CALLBACK_ENABLED = "true";
    const r = await maybeCreateCutoffCallback({ conversationId: "c", phoneE164: PHONE, durationSecs: 300 });
    expect(r).toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("no-op when an open follow-up already exists (dedup)", async () => {
    process.env.FRANK_CUTOFF_CALLBACK_ENABLED = "true";
    mockQuery.mockResolvedValueOnce({ rows: [ROW] }); // getOpenFollowUpsByPhone → already open
    const r = await maybeCreateCutoffCallback({ conversationId: "c", phoneE164: PHONE, durationSecs: 901 });
    expect(r).toBeNull();
    expect(mockQuery).toHaveBeenCalledTimes(1); // only the SELECT, never the INSERT
  });

  it("creates an immediate time_cutoff callback when a call hit the cap mid-process", async () => {
    process.env.FRANK_CUTOFF_CALLBACK_ENABLED = "true";
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // getOpenFollowUpsByPhone → none open
      .mockResolvedValueOnce({ rows: [ROW] }); // createFollowUp INSERT
    const r = await maybeCreateCutoffCallback({ conversationId: "conv_cut", phoneE164: PHONE, durationSecs: 901 });
    expect(r).not.toBeNull();
    const insertSql = String(mockQuery.mock.calls[1][0]);
    expect(insertSql).toContain("INSERT INTO follow_ups");
    const params = mockQuery.mock.calls[1][1] as unknown[];
    expect(params[3]).toBe("time_cutoff"); // reason
    expect(String(params[7])).toContain("Pick up exactly where you left off"); // checkpoint
  });

  it("respects a custom FRANK_CALL_MAX_SECS floor", async () => {
    process.env.FRANK_CUTOFF_CALLBACK_ENABLED = "true";
    process.env.FRANK_CALL_MAX_SECS = "600";
    mockQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [ROW] });
    const r = await maybeCreateCutoffCallback({ conversationId: "c", phoneE164: PHONE, durationSecs: 590 }); // >= 570 floor
    expect(r).not.toBeNull();
  });
});
