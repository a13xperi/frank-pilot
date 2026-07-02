import { fetchWithTimeout } from "./fetch";
import { getHeartbeat, DIALER_HEARTBEAT } from "./heartbeat";
import { logger } from "./logger";
import { isWithinCallWindow } from "../modules/outbound-validation/dialer";

/**
 * Extended /health signals (backlog #12): Sage + ElevenLabs reachability and
 * outbound-dialer tick freshness. These are BODY-level signals for alerting;
 * they deliberately never gate the HTTP status code — see the /health handler.
 */

export type ReachStatus = "ok" | "unreachable" | "not_configured" | `http_${number}`;

const PROBE_TIMEOUT_MS = 3_000;
const REACH_CACHE_MS = 60_000;

/** Any HTTP answer proves the socket path; non-2xx (e.g. a revoked key's 401)
 * is still surfaced so the alert distinguishes "down" from "auth broken". */
async function probe(url: string, headers: Record<string, string>): Promise<ReachStatus> {
  try {
    const res = await fetchWithTimeout(url, { headers, timeoutMs: PROBE_TIMEOUT_MS });
    return res.ok ? "ok" : (`http_${res.status}` as ReachStatus);
  } catch {
    return "unreachable";
  }
}

let reachCache: { at: number; sage: ReachStatus; elevenlabs: ReachStatus } | null = null;

/** Test seam: drop the memoized probe results. */
export function __resetReachabilityCacheForTests(): void {
  reachCache = null;
}

/**
 * Reachability of the two upstreams the dialer cannot run without. Memoized
 * for 60s so a frequently-polled /health doesn't turn into upstream load; the
 * probes are 3s-bounded so /health stays fast even when an upstream is dark.
 */
export async function externalReachability(
  now: Date = new Date()
): Promise<{ sage: ReachStatus; elevenlabs: ReachStatus }> {
  if (reachCache && now.getTime() - reachCache.at < REACH_CACHE_MS) {
    return { sage: reachCache.sage, elevenlabs: reachCache.elevenlabs };
  }

  const sageUrl = (process.env.GPM_SUPABASE_URL ?? "").replace(/\/$/, "");
  const sageKey = process.env.GPM_SUPABASE_SERVICE_ROLE_KEY ?? "";
  const elKey = process.env.ELEVENLABS_API_KEY ?? "";

  const [sage, elevenlabs] = await Promise.all([
    sageUrl && sageKey
      ? // PostgREST root: 200 proves DNS + TLS + gateway + service-role auth.
        probe(`${sageUrl}/rest/v1/`, {
          apikey: sageKey,
          Authorization: `Bearer ${sageKey}`,
        })
      : Promise.resolve<ReachStatus>("not_configured"),
    elKey
      ? probe("https://api.elevenlabs.io/v1/models", { "xi-api-key": elKey })
      : Promise.resolve<ReachStatus>("not_configured"),
  ]);

  reachCache = { at: now.getTime(), sage, elevenlabs };
  return { sage, elevenlabs };
}

export interface DialerTickStatus {
  enabled: boolean;
  state: "disabled" | "idle_outside_window" | "warming" | "ticking" | "stale";
  healthy: boolean;
  lastTickAt: string | null;
  staleMinutes: number | null;
}

/** Dialer cron cadence is 5 min; 15 min = three straight missed ticks. */
const STALE_AFTER_MINUTES = 15;
const WINDOW_OPEN_HOUR_PT = 9;

function minutesSinceWindowOpenPT(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  return (get("hour") % 24 - WINDOW_OPEN_HOUR_PT) * 60 + get("minute");
}

/**
 * Tick freshness for the outbound validation dialer. Unhealthy ⇔ the dialer is
 * enabled, we are inside the 9am–8pm PT call window (past a 15-min warm-up
 * after the window opens — the last beat legitimately dates from yesterday
 * until the first tick lands), and no successful tick beat in >15 min. Outside
 * the window a silent dialer is indistinguishable from a correctly idle one,
 * so freshness is only judged in-window.
 */
export async function dialerTickStatus(now: Date = new Date()): Promise<DialerTickStatus> {
  const enabled = process.env.FRANK_OUTBOUND_ENABLED === "true";

  let lastTickAt: string | null = null;
  let staleMinutes: number | null = null;
  try {
    const hb = await getHeartbeat(DIALER_HEARTBEAT);
    if (hb) {
      lastTickAt = hb.beatAt.toISOString();
      staleMinutes = Math.floor((now.getTime() - hb.beatAt.getTime()) / 60_000);
    }
  } catch (err) {
    // Table missing (migration pending) or a read blip: treat as "never beat" —
    // in-window that correctly reads as stale — but never fail /health itself.
    logger.warn("dialerTickStatus heartbeat read failed", {
      error: (err as Error).message,
    });
  }

  const base = { enabled, lastTickAt, staleMinutes };
  if (!enabled) return { ...base, state: "disabled", healthy: true };
  if (!isWithinCallWindow(now)) return { ...base, state: "idle_outside_window", healthy: true };

  const fresh = staleMinutes !== null && staleMinutes <= STALE_AFTER_MINUTES;
  if (fresh) return { ...base, state: "ticking", healthy: true };
  if (minutesSinceWindowOpenPT(now) < STALE_AFTER_MINUTES) {
    return { ...base, state: "warming", healthy: true };
  }
  return { ...base, state: "stale", healthy: false };
}
