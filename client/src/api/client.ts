const TOKEN_KEY = 'frank_token';
const USER_KEY = 'frank_user';

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
  const token = localStorage.getItem(TOKEN_KEY);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const method = (options.method ?? 'GET').toUpperCase();
  const t0 = performance.now();
  const res = await fetch(path, { ...options, headers });

  if (subs.size > 0) {
    const evt: ApiEvent = {
      method,
      path,
      status: res.status,
      ok: res.ok,
      durationMs: Math.round(performance.now() - t0),
      ts: Date.now(),
    };
    for (const s of subs) {
      try { s(evt); } catch { /* swallow subscriber errors */ }
    }
  }

  if (res.status === 401 && !path.includes('/api/auth/login')) {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    window.location.href = '/login';
    throw new Error('Session expired');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }

  return res.json();
}

/**
 * Fetch a binary artifact (PNG, etc.) with the Bearer token attached, returning
 * an object URL suitable for `<img src>` or `<a href>`. Caller is responsible
 * for revoking the URL via `URL.revokeObjectURL` when the resource unmounts.
 */
async function getBlobUrl(path: string): Promise<string> {
  const token = localStorage.getItem(TOKEN_KEY);
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(path, { headers });
  if (res.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    window.location.href = '/login';
    throw new Error('Session expired');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  getBlobUrl,
};
