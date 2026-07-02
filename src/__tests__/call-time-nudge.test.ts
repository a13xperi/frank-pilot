/**
 * Tests for the piggyback time nudge — the in-call wrap warning that rides on
 * whatever tool Frank already calls, instead of a passive prompt clock (frozen
 * at 0 on EL) or a native cap message (never speaks on the Twilio path).
 *
 * Two layers:
 *   - computeTimeNudge (call-time-core): pure decision — null unless the params
 *     carry the live clock AND we're in the soft/wrap window.
 *   - the tool dispatch route: appends that nudge to ANY tool's result message
 *     (except check_call_time, which already speaks about time itself).
 *
 * Defaults under test (no env set): MAX=900, SOFT=300, WRAP=180.
 */

const mockQuery = jest.fn();
jest.mock("../config/database", () => ({ query: (...a: unknown[]) => mockQuery(...a) }));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../modules/tape", () => ({ stampTape: jest.fn() }));

import express from "express";
import request from "supertest";
import { computeTimeNudge } from "../modules/follow-ups/call-time-core";
import toolRouter, {
  registerToolHandler,
  clearToolHandlersForTests,
} from "../modules/voice-intake/tool-callbacks";

describe("computeTimeNudge (pure)", () => {
  it("returns null when no call clock is present", () => {
    expect(computeTimeNudge({})).toBeNull();
    expect(computeTimeNudge({ phone: "x" })).toBeNull();
  });

  it("returns null with plenty of time left (ok phase)", () => {
    expect(computeTimeNudge({ call_duration_secs: 60 })).toBeNull(); // 840 left
  });

  it("returns a SOFT nudge inside the heads-up window", () => {
    const n = computeTimeNudge({ call_duration_secs: 650 }); // 250 left
    expect(n?.phase).toBe("soft");
    expect(n?.remainingSecs).toBe(250);
    expect(n?.message).toMatch(/Time check/);
  });

  it("returns a WRAP nudge inside the wrap window → schedule_followup + checkpoint", () => {
    const n = computeTimeNudge({ call_duration_secs: 750 }); // 150 left
    expect(n?.phase).toBe("wrap");
    expect(n?.message).toMatch(/schedule_followup/);
    expect(n?.message).toMatch(/checkpoint/i);
    expect(n?.message).toMatch(/call them right back/i);
  });

  it("reads the clock from a numeric string (dynamic-var injection)", () => {
    expect(computeTimeNudge({ call_duration_secs: "750" })?.phase).toBe("wrap");
  });

  it("reads the raw system__call_duration_secs key too", () => {
    expect(computeTimeNudge({ system__call_duration_secs: 750 })?.phase).toBe("wrap");
  });
});

describe("tool dispatch appends the nudge", () => {
  const SECRET = "wsec_testsecret";
  const TOOL_SECRET = "eltool_testsecret";
  const ENV_KEYS = ["VOICE_TOOLS_ENABLED", "ELEVENLABS_WEBHOOK_SECRET", "ELEVENLABS_TOOL_SECRET"];
  const savedEnv: Record<string, string | undefined> = {};
  let app: express.Express;

  beforeAll(() => {
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  });
  afterAll(() => {
    // Restore env so we don't leak test secrets into later suites in this worker.
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.VOICE_TOOLS_ENABLED = "true";
    process.env.ELEVENLABS_WEBHOOK_SECRET = SECRET;
    process.env.ELEVENLABS_TOOL_SECRET = TOOL_SECRET;
    // alreadyProcessed SELECT → none; markProcessed INSERT → ok. The static-
    // path replay-nonce claim (C3) is an INSERT … RETURNING and must return
    // the claimed row, or every call here would read as a suppressed replay.
    mockQuery.mockImplementation(async (sql: unknown, params?: unknown[]) => {
      const s = String(sql);
      if (/INSERT INTO elevenlabs_processed_events/i.test(s) && /RETURNING/i.test(s)) {
        return { rows: [{ event_id: String((params as unknown[] | undefined)?.[0] ?? "") }] };
      }
      return { rows: [] };
    });
    clearToolHandlersForTests();
    registerToolHandler("present_options", async () => ({
      ok: true,
      result: { options: 3 },
      message: "Here are three options.",
    }));
    // a stand-in for check_call_time so we can prove it is NOT double-nudged
    registerToolHandler("check_call_time", async () => ({
      ok: true,
      result: { phase: "wrap" },
      message: "You have about 2 minutes left.",
    }));
    app = express();
    app.use("/api/webhooks/elevenlabs/tools", toolRouter);
  });

  function call(tool: string, body: Record<string, unknown>) {
    return request(app)
      .post(`/api/webhooks/elevenlabs/tools/${tool}`)
      .set("x-elevenlabs-tool-secret", TOOL_SECRET)
      .set("Content-Type", "application/json")
      .send(body);
  }

  it("appends the wrap nudge to a normal tool when the clock is late", async () => {
    const res = await call("present_options", { call_duration_secs: 750 });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.message).toMatch(/Here are three options\./); // original kept
    expect(res.body.message).toMatch(/Time check/); // nudge appended
    expect(res.body.message).toMatch(/schedule_followup/);
    expect(res.body.result.time_phase).toBe("wrap");
  });

  it("leaves a normal tool untouched when there is plenty of time", async () => {
    const res = await call("present_options", { call_duration_secs: 60 });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Here are three options.");
    expect(res.body.result.time_phase).toBeUndefined();
  });

  it("does NOT double-nudge check_call_time (it speaks about time itself)", async () => {
    const res = await call("check_call_time", { call_duration_secs: 750 });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe("You have about 2 minutes left.");
    expect(res.body.message).not.toMatch(/Time check/);
  });
});
