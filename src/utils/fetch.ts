/**
 * Shared outbound-HTTP helpers (backlog #10): every external fetch carries a
 * hard deadline, so a hung vendor / ElevenLabs / Sage socket can never stall a
 * screening run or dialer tick indefinitely while holding a DB client.
 *
 * New call sites should use these instead of bare fetch(). The pre-existing
 * sites that inline `signal: AbortSignal.timeout(10000)` (#393) are equivalent
 * and may migrate here opportunistically.
 */

export const DEFAULT_FETCH_TIMEOUT_MS = 10_000;

export interface FetchWithTimeoutInit extends RequestInit {
  /** Hard deadline for the whole request. Default 10s; override per call-site. */
  timeoutMs?: number;
}

/**
 * fetch() with a deadline. Rejects with a TimeoutError DOMException when the
 * deadline elapses — same failure surface callers already handle for network
 * errors. A caller-supplied signal composes with (never replaces) the timeout.
 */
export async function fetchWithTimeout(
  url: string,
  init: FetchWithTimeoutInit = {}
): Promise<Response> {
  const { timeoutMs = DEFAULT_FETCH_TIMEOUT_MS, signal, ...rest } = init;
  const timeout = AbortSignal.timeout(timeoutMs);
  return fetch(url, {
    ...rest,
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
}

/**
 * fetchWithTimeout + non-2xx check + parsed JSON body, for call sites that
 * just want data-or-throw. The thrown message carries the status and a bounded
 * slice of the response body (same shape sage-client uses), never the URL's
 * query string (may hold keys/PII).
 */
export async function fetchJson<T = unknown>(
  url: string,
  init: FetchWithTimeoutInit = {}
): Promise<T> {
  const res = await fetchWithTimeout(url, init);
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const path = url.split("?")[0];
    throw new Error(
      `${init.method ?? "GET"} ${path} failed: ${res.status} ${detail.slice(0, 300)}`
    );
  }
  return (await res.json()) as T;
}
