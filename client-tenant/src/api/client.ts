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

  const fullPath = path.startsWith('/api') ? path : `/api${path.startsWith('/') ? path : `/${path}`}`;

  const res = await fetch(fullPath, { ...options, headers });

  if (res.status === 401 && !fullPath.includes('/auth/magic-link')) {
    clearToken();
    window.location.href = '/login';
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
