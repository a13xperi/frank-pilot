// Demo / usability-testing session state.
//
// A tester opens the app via a deep link: `https://…/?demo=<TOKEN>`. That
// token is the shared `DEMO_LINK_SECRET` configured on the backend — holding
// it is what unlocks the echoed magic-link (see src/utils/demo-link.ts), so a
// tester can walk the *real* auth funnel without a working inbox.
//
// On first load with `?demo=`, we:
//   1. stash the token in sessionStorage (so it survives navigation within the
//      tab but does not leak into a shared/long-lived store),
//   2. mint a per-tab `runId` (cohort key) used to group every captured
//      artifact for this walkthrough under `demo/{runId}/…` in Supabase,
//   3. strip `?demo=` from the visible URL so a tester can't accidentally
//      copy/paste an account-takeover-grade link into a public channel.
//
// Everything is sessionStorage-scoped: close the tab and the demo identity is
// gone. Nothing here changes behaviour unless a `?demo=` token was supplied.

const TOKEN_KEY = "frank_demo_token";
const RUN_KEY = "frank_demo_run";
const QUERY_PARAM = "demo";

function genRunId(): string {
  // Short, sortable, collision-resistant enough for a handful of testers.
  const rand = Math.random().toString(36).slice(2, 8);
  return `r${Date.now().toString(36)}-${rand}`;
}

/**
 * Read `?demo=<TOKEN>` once at boot, persist token + runId for the tab, and
 * clean the param out of the address bar. Safe to call unconditionally; a
 * no-op when the param is absent. Returns true if a demo session is active.
 */
export function initDemoSession(): boolean {
  if (typeof window === "undefined") return false;

  try {
    const url = new URL(window.location.href);
    const token = url.searchParams.get(QUERY_PARAM);
    if (token) {
      sessionStorage.setItem(TOKEN_KEY, token);
      if (!sessionStorage.getItem(RUN_KEY)) {
        sessionStorage.setItem(RUN_KEY, genRunId());
      }
      // Scrub the token from the visible URL without a navigation.
      url.searchParams.delete(QUERY_PARAM);
      window.history.replaceState({}, "", url.pathname + url.search + url.hash);
    }
  } catch {
    // Malformed URL / storage disabled — demo mode simply stays off.
  }

  const active = isDemoMode();
  if (active) {
    // Dynamic import avoids a static cycle (demoCapture imports this module)
    // and keeps rrweb out of the bundle for non-demo loads. Fire-and-forget.
    void import("./demoCapture").then((m) => m.startDemoCapture());
  }
  return active;
}

/** True when this tab is running a captured usability walkthrough. */
export function isDemoMode(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return !!sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return false;
  }
}

/** The shared demo token, sent as `x-demo-token` so the backend echoes links. */
export function getDemoToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/** The per-tab cohort id grouping all captured artifacts for this walkthrough. */
export function getRunId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return sessionStorage.getItem(RUN_KEY);
  } catch {
    return null;
  }
}
