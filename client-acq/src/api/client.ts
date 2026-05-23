// Shares the staff console's auth storage keys so a session established in one
// internal app carries to the other (same backend, same token).
const TOKEN_KEY = 'frank_token';
const USER_KEY = 'frank_user';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem(TOKEN_KEY);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(path, { ...options, headers });

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

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),

  // ── Recertifications ─────────────────────────────────────────────────────

  /** List all recertifications. */
  getRecertifications: <T>() => request<T>('/api/recertifications'),

  /** Fetch the income-check verdict for one recertification. */
  getRecertIncomeCheck: <T>(id: string) =>
    request<T>(`/api/recertifications/${id}/income-check`),

  /** Resolve NAU (Non-Arm's-Length Unit) for a recertification. */
  resolveNau: <T>(id: string, body: { resolvingUnitId: string; notes?: string | null }) =>
    request<T>(`/api/recertifications/${id}/nau-resolve`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // ── AUR compliance queue ─────────────────────────────────────────────────

  /** List over-income / AUR households queue. */
  getAurQueue: <T>(params: { propertyId?: string; limit?: number; offset?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.propertyId) qs.set('propertyId', params.propertyId);
    if (params.limit != null) qs.set('limit', String(params.limit));
    if (params.offset != null) qs.set('offset', String(params.offset));
    const query = qs.toString();
    return request<T>(`/api/acquisitions/aur-queue${query ? `?${query}` : ''}`);
  },
};
