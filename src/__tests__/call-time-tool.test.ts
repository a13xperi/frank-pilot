/**
 * Tests for check_call_time — the call clock that lets Frank wrap + schedule a
 * follow-up before the duration cut. Pure handler; DB/logger mocked only because
 * the dispatch module it imports pulls them in.
 *
 * Defaults under test (no env set): MAX=900, SOFT=300, WRAP=180.
 *   remaining > 300        → ok    (keep going)
 *   180 < remaining <= 300 → soft  (land the current step)
 *   remaining <= 180       → wrap  (warn + schedule_followup + wrap)
 */

jest.mock("../config/database", () => ({ query: jest.fn() }));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { checkCallTimeHandler, __config } from "../modules/follow-ups/call-time";

const CTX = {
  agentId: "a",
  conversationId: "conv_T",
  toolCallId: "tc",
  toolName: "check_call_time" as const,
};

describe("check_call_time", () => {
  it("defaults to a 900s cap with 300s/180s thresholds", () => {
    expect(__config.MAX_CALL_SECS).toBe(900);
    expect(__config.SOFT_REMAINING_SECS).toBe(300);
    expect(__config.WRAP_REMAINING_SECS).toBe(180);
  });

  it("phase=ok with lots of time left", async () => {
    const r = await checkCallTimeHandler({ call_duration_secs: 60 }, CTX);
    expect(r.ok).toBe(true);
    expect(r.result?.phase).toBe("ok");
    expect(r.result?.remaining_secs).toBe(840);
    expect(r.result?.should_wrap).toBe(false);
  });

  it("phase=soft inside the heads-up window", async () => {
    const r = await checkCallTimeHandler({ call_duration_secs: 650 }, CTX); // 250 left
    expect(r.result?.phase).toBe("soft");
    expect(r.result?.should_wrap).toBe(false);
  });

  it("phase=wrap inside the wrap window → instructs schedule_followup + checkpoint", async () => {
    const r = await checkCallTimeHandler({ call_duration_secs: 750 }, CTX); // 150 left
    expect(r.result?.phase).toBe("wrap");
    expect(r.result?.should_wrap).toBe(true);
    expect(r.message).toMatch(/schedule_followup/);
    expect(r.message).toMatch(/checkpoint/i);
  });

  it("clamps remaining at 0 past the cap (still wrap)", async () => {
    const r = await checkCallTimeHandler({ call_duration_secs: 1200 }, CTX);
    expect(r.result?.remaining_secs).toBe(0);
    expect(r.result?.phase).toBe("wrap");
  });

  it("accepts the elapsed value as a numeric string (dynamic-var injection)", async () => {
    const r = await checkCallTimeHandler({ call_duration_secs: "750" }, CTX);
    expect(r.result?.phase).toBe("wrap");
    expect(r.result?.remaining_secs).toBe(150);
  });

  it("fails SOFT (ok:true) when the elapsed value is missing — never blocks the call", async () => {
    const r = await checkCallTimeHandler({}, CTX);
    expect(r.ok).toBe(true);
    expect(r.result?.phase).toBe("unknown");
    expect(r.result?.should_wrap).toBe(false);
  });
});
