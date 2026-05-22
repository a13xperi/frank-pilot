import { api, setToken } from './client';

interface MagicLinkRequestResponse {
  ok: boolean;
}

interface MagicLinkVerifyResponse {
  token: string;
}

// wedge #13: optional Turnstile token. Senders that don't have a widget on
// screen (e.g. an in-app resend from a session that already passed Turnstile
// at register time) can omit it — the server still rate-limits, and in dev
// the verify-turnstile middleware bypasses when TURNSTILE_SECRET_KEY is
// unset. Production resend surfaces must mount the widget.
export async function requestMagicLink(
  email: string,
  turnstileToken?: string,
): Promise<MagicLinkRequestResponse> {
  return api.post<MagicLinkRequestResponse>('/auth/magic-link/request', {
    email,
    ...(turnstileToken ? { turnstileToken } : {}),
  });
}

export async function verifyMagicLink(token: string): Promise<MagicLinkVerifyResponse> {
  const res = await api.post<MagicLinkVerifyResponse>('/auth/magic-link/verify', { token });
  if (res.token) {
    setToken(res.token);
  }
  return res;
}
