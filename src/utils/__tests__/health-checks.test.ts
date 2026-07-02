/**
 * Extended /health signals (backlog #12).
 *
 * dialerTickStatus is the "silent dialer death" alarm: unhealthy ONLY when the
 * dialer is enabled, inside the 9am–8pm PT window (past the 15-min warm-up),
 * and no successful tick beat in >15 min. Every other combination must read
 * healthy — a false alarm outside the window or during warm-up would train
 * operators to ignore the signal.
 *
 * externalReachability memoizes for 60s so a polled /health doesn't become
 * upstream load, and maps auth failure (http_401) distinctly from "unreachable".
 */
import {
  dialerTickStatus,
  externalReachability,
  __resetReachabilityCacheForTests,
} from "../health-checks";
import { getHeartbeat } from "../heartbeat";
import { fetchWithTimeout } from "../fetch";
import { isWithinCallWindow } from "../../modules/outbound-validation/dialer";

jest.mock("../heartbeat", () => ({
  getHeartbeat: jest.fn(),
  DIALER_HEARTBEAT: "outbound_dialer_tick",
}));

jest.mock("../fetch", () => ({
  fetchWithTimeout: jest.fn(),
}));

jest.mock("../logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// Window logic itself is the dialer's (tested there); pin it per-case here.
jest.mock("../../modules/outbound-validation/dialer", () => ({
  isWithinCallWindow: jest.fn(),
}));

const getHeartbeatMock = getHeartbeat as jest.Mock;
const fetchMock = fetchWithTimeout as jest.Mock;
const windowMock = isWithinCallWindow as jest.Mock;

// 16:30 PT on Jul 2 2026 (PDT = UTC-7) — deep inside the call window.
const MID_WINDOW = new Date("2026-07-02T23:30:00Z");
// 09:05 PT — window just opened, first cron tick may not have fired yet.
const WINDOW_JUST_OPENED = new Date("2026-07-02T16:05:00Z");

const ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ENV };
  jest.clearAllMocks();
  __resetReachabilityCacheForTests();
});

function beatAgoMinutes(now: Date, minutes: number): void {
  getHeartbeatMock.mockResolvedValue({
    beatAt: new Date(now.getTime() - minutes * 60_000),
    detail: {},
  });
}

describe("dialerTickStatus", () => {
  it("disabled dialer → healthy/disabled (no false alarm before launch)", async () => {
    process.env.FRANK_OUTBOUND_ENABLED = "false";
    getHeartbeatMock.mockResolvedValue(null);

    const s = await dialerTickStatus(MID_WINDOW);

    expect(s).toMatchObject({ enabled: false, state: "disabled", healthy: true });
  });

  it("enabled but outside the call window → healthy/idle", async () => {
    process.env.FRANK_OUTBOUND_ENABLED = "true";
    windowMock.mockReturnValue(false);
    beatAgoMinutes(MID_WINDOW, 600);

    const s = await dialerTickStatus(MID_WINDOW);

    expect(s).toMatchObject({ state: "idle_outside_window", healthy: true });
  });

  it("fresh beat in-window → ticking/healthy", async () => {
    process.env.FRANK_OUTBOUND_ENABLED = "true";
    windowMock.mockReturnValue(true);
    beatAgoMinutes(MID_WINDOW, 3);

    const s = await dialerTickStatus(MID_WINDOW);

    expect(s).toMatchObject({ state: "ticking", healthy: true, staleMinutes: 3 });
    expect(s.lastTickAt).toBe(new Date(MID_WINDOW.getTime() - 3 * 60_000).toISOString());
  });

  it("beat >15 min old, mid-window → STALE and unhealthy (the alarm)", async () => {
    process.env.FRANK_OUTBOUND_ENABLED = "true";
    windowMock.mockReturnValue(true);
    beatAgoMinutes(MID_WINDOW, 40);

    const s = await dialerTickStatus(MID_WINDOW);

    expect(s).toMatchObject({ state: "stale", healthy: false, staleMinutes: 40 });
  });

  it("no beat ever, mid-window → stale/unhealthy", async () => {
    process.env.FRANK_OUTBOUND_ENABLED = "true";
    windowMock.mockReturnValue(true);
    getHeartbeatMock.mockResolvedValue(null);

    const s = await dialerTickStatus(MID_WINDOW);

    expect(s).toMatchObject({ state: "stale", healthy: false, lastTickAt: null });
  });

  it("stale beat but window opened <15 min ago → warming, not a false alarm", async () => {
    process.env.FRANK_OUTBOUND_ENABLED = "true";
    windowMock.mockReturnValue(true);
    beatAgoMinutes(WINDOW_JUST_OPENED, 700); // yesterday's last tick

    const s = await dialerTickStatus(WINDOW_JUST_OPENED);

    expect(s).toMatchObject({ state: "warming", healthy: true });
  });

  it("heartbeat read failure (e.g. migration pending) → stale, /health never throws", async () => {
    process.env.FRANK_OUTBOUND_ENABLED = "true";
    windowMock.mockReturnValue(true);
    getHeartbeatMock.mockRejectedValue(new Error("relation does not exist"));

    const s = await dialerTickStatus(MID_WINDOW);

    expect(s).toMatchObject({ state: "stale", healthy: false, lastTickAt: null });
  });
});

describe("externalReachability", () => {
  function configureUpstreams(): void {
    process.env.GPM_SUPABASE_URL = "https://sage.test";
    process.env.GPM_SUPABASE_SERVICE_ROLE_KEY = "sage-key";
    process.env.ELEVENLABS_API_KEY = "el-key";
  }

  it("not_configured when env is absent (no probe fired)", async () => {
    delete process.env.GPM_SUPABASE_URL;
    delete process.env.GPM_SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.ELEVENLABS_API_KEY;

    const r = await externalReachability(MID_WINDOW);

    expect(r).toEqual({ sage: "not_configured", elevenlabs: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ok on 2xx; auth failure surfaces as http_401, network failure as unreachable", async () => {
    configureUpstreams();
    fetchMock.mockImplementation((url: string) => {
      if (url.startsWith("https://sage.test")) {
        return Promise.resolve(new Response("{}", { status: 200 }));
      }
      return Promise.resolve(new Response("nope", { status: 401 }));
    });

    expect(await externalReachability(MID_WINDOW)).toEqual({
      sage: "ok",
      elevenlabs: "http_401",
    });

    __resetReachabilityCacheForTests();
    fetchMock.mockRejectedValue(new Error("socket hang up"));

    expect(await externalReachability(MID_WINDOW)).toEqual({
      sage: "unreachable",
      elevenlabs: "unreachable",
    });
  });

  it("memoizes for 60s, re-probes after", async () => {
    configureUpstreams();
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));

    await externalReachability(MID_WINDOW);
    await externalReachability(new Date(MID_WINDOW.getTime() + 30_000));
    expect(fetchMock).toHaveBeenCalledTimes(2); // one probe per upstream, once

    await externalReachability(new Date(MID_WINDOW.getTime() + 61_000));
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
