import { api, setToken } from './client';

interface MagicLinkRequestResponse {
  ok: boolean;
}

interface MagicLinkVerifyResponse {
  token: string;
}

export async function requestMagicLink(email: string): Promise<MagicLinkRequestResponse> {
  return api.post<MagicLinkRequestResponse>('/auth/magic-link/request', { email });
}

export async function verifyMagicLink(token: string): Promise<MagicLinkVerifyResponse> {
  const res = await api.post<MagicLinkVerifyResponse>('/auth/magic-link/verify', { token });
  if (res.token) {
    setToken(res.token);
  }
  return res;
}
