import { getDemoToken, getRunId } from '../lib/demoSession';

const TOKEN_KEY = 'frank_tenant_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

// Demo overlay subscriber registry. Dev-only consumer; pure additive — every
// existing caller behaves the same and there are no subscribers in prod builds.
export type ApiEvent = {
  method: string;
  path: string;
  status: number;
  ok: boolean;
  durationMs: number;
  ts: number;
};
type Subscriber = (e: ApiEvent) => void;
const subs = new Set<Subscriber>();
export function onApiEvent(cb: Subscriber): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  // Demo/usability sessions carry the shared secret so the backend echoes the
  // magic-link in the response (register + magic-link/request). No-op outside
  // a `?demo=<TOKEN>` walkthrough. See lib/demoSession + src/utils/demo-link.
  const demoToken = getDemoToken();
  if (demoToken) {
    headers['x-demo-token'] = demoToken;
    const runId = getRunId();
    // Lets the backend tag demo signups (users.demo_run_id) for metric
    // exclusion + teardown. Only meaningful alongside a valid x-demo-token.
    if (runId) headers['x-demo-run'] = runId;
  }

  const relativePath = path.startsWith('/api') ? path : `/api${path.startsWith('/') ? path : `/${path}`}`;
  const baseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';
  const fullPath = baseUrl ? `${baseUrl}${relativePath}` : relativePath;

  // credentials:'include' so the httpOnly `uh_guest` cookie (guest shortlist)
  // round-trips on every request — set by the backend on a guest's first save
  // and read back on subsequent saves/reads + magic-link conversion. Harmless
  // for the JWT-authed endpoints (they ignore the cookie).
  const method = (options.method ?? 'GET').toUpperCase();
  const t0 = performance.now();
  const res = await fetch(fullPath, { ...options, headers, credentials: 'include' });

  if (subs.size > 0) {
    const evt: ApiEvent = {
      method,
      path: relativePath,
      status: res.status,
      ok: res.ok,
      durationMs: Math.round(performance.now() - t0),
      ts: Date.now(),
    };
    for (const s of subs) {
      try { s(evt); } catch { /* swallow subscriber errors */ }
    }
  }

  // /auth/me is the probe endpoint — callers (AuthCallback, VerifyPending,
  // the Apply step='verify' poll) use it to discover auth state and handle
  // 401 locally. A hard redirect here ejects users mid-flow from the
  // verify-pending screen and the magic-link callback.
  const isAuthProbe =
    fullPath.includes('/auth/magic-link') || fullPath.includes('/auth/me');
  if (res.status === 401 && !isAuthProbe) {
    // A stale/expired token in localStorage makes guest-allowed pages issue
    // authed calls (e.g. discover warm-fetching /applicants/units) that 401.
    // On a PUBLIC page that just means "treat me as a guest" — clear the dead
    // token and let the caller fall back (discover renders from fixtures, the
    // saved shortlist reads the guest cookie). Only hard-redirect to /login
    // from auth-gated routes, where a 401 is a genuine session expiry.
    const PUBLIC_PREFIXES = [
      '/discover',
      '/property',
      '/saved',
      '/welcome',
      '/apply',
      '/waitlist',
      '/privacy',
      '/cookies',
    ];
    const path = typeof window !== 'undefined' ? window.location.pathname : '';
    const onPublicPage =
      path === '/' || PUBLIC_PREFIXES.some((p) => path.startsWith(p));
    clearToken();
    if (!onPublicPage) {
      window.location.href = '/login';
    }
    throw new Error('Session expired');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    // WARN #2: an unverified applicant hitting a gated route gets 403 +
    // code "EMAIL_UNVERIFIED". Bounce to the verify-pending page rather
    // than surfacing a raw error — the user just needs to click their link.
    if (
      res.status === 403 &&
      body?.code === "EMAIL_UNVERIFIED" &&
      typeof window !== "undefined" &&
      !window.location.pathname.startsWith("/verify-pending")
    ) {
      window.location.href = "/verify-pending";
      throw new Error("Email verification required");
    }
    let msg = body.error || `Request failed: ${res.status}`;
    if (Array.isArray(body.details) && body.details.length > 0) {
      const fields = body.details
        .map((d: { path?: (string | number)[]; message?: string }) => {
          const field = Array.isArray(d.path) ? d.path.join('.') : '';
          return field ? `${field}: ${d.message}` : d.message;
        })
        .filter(Boolean)
        .join('; ');
      if (fields) msg = `${msg} — ${fields}`;
    }
    throw new Error(msg);
  }

  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

/**
 * Ask the grounded housing Q&A assistant a question. Public endpoint — no auth
 * required (the chat widget is shown to pre-registration visitors). Routes
 * through the shared request() wrapper so demo-token / base-URL handling stays
 * consistent. Backend: POST /api/housing-qa (non-streaming, returns the full
 * answer in one response).
 */
export function askHousingQa(question: string): Promise<{ answer: string }> {
  return api.post<{ answer: string }>('/housing-qa', { question });
}

/**
 * "Talk to Frank" — mint an ElevenLabs Conv. AI WebRTC signed URL.
 *
 * Returns a discriminated union so the pill can switch on outcome without
 * threading try/catch + status-code parsing through React. The 503 branch is
 * load-bearing: it covers both "feature flag is off" and "daily budget cap
 * exhausted" — the pill hides itself on either signal and stays hidden for
 * the rest of the page lifetime.
 *
 * Anonymous-allowed. The backend mints a `frank_voice_session` cookie on the
 * first call; credentials:'include' is already set on every fetch via the
 * shared request() path, but this endpoint sits OUTSIDE request() (we need
 * the raw status code) so credentials:'include' is set explicitly here too.
 */
export type StartVoiceSessionResult =
  | {
      status: 'ok';
      signedUrl: string;
      agentId: string;
      sessionId: string;
      maxDurationSecs: number;
    }
  | { status: 'disabled' }
  | { status: 'rate_limited'; retryAfterSecs: number | null }
  | { status: 'error'; message: string };

export async function startVoiceSession(): Promise<StartVoiceSessionResult> {
  const baseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';
  const url = `${baseUrl}/api/voice/sessions`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    });
  } catch (err) {
    return { status: 'error', message: (err as Error).message };
  }
  if (res.status === 503) return { status: 'disabled' };
  if (res.status === 429) {
    const retryAfter = res.headers.get('Retry-After');
    const secs = retryAfter ? Number(retryAfter) : null;
    return { status: 'rate_limited', retryAfterSecs: Number.isFinite(secs) ? secs : null };
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    return { status: 'error', message: body?.error || `Request failed: ${res.status}` };
  }
  const body = (await res.json()) as {
    signedUrl: string;
    agentId: string;
    sessionId: string;
    maxDurationSecs: number;
  };
  return { status: 'ok', ...body };
}
