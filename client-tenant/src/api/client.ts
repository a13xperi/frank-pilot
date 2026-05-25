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
  const res = await fetch(fullPath, { ...options, headers, credentials: 'include' });

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
