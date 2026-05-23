// Shared Supabase-storage upload used by QA capture (ScreenshotButton) and the
// demo/usability harness (session-replay + event timeline). Uploads go direct
// from the browser to the public `frank-qa-screenshots` bucket using the
// publishable key — no backend round-trip. Keep this the single writer so the
// bucket name and headers stay in one place.

export const SUPA_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
export const SUPA_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as
  | string
  | undefined;
export const QA_BUCKET = 'frank-qa-screenshots';

/** True when storage env vars are present and uploads can be attempted. */
export function qaUploadConfigured(): boolean {
  return Boolean(SUPA_URL && SUPA_KEY);
}

/**
 * Upload a single object to `frank-qa-screenshots/{path}` (upsert) and return
 * its public URL. Throws on missing env or a non-2xx response.
 *
 * `keepalive` lets a flush survive a `pagehide`/`visibilitychange:hidden` —
 * the demo harness uses it to land the final replay segment + manifest as the
 * tester navigates away or closes the tab.
 */
export async function uploadToSupabase(
  body: BodyInit,
  path: string,
  contentType: string,
  opts: { keepalive?: boolean } = {},
): Promise<string> {
  if (!SUPA_URL || !SUPA_KEY) throw new Error('Supabase storage env vars missing');
  const res = await fetch(`${SUPA_URL}/storage/v1/object/${QA_BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      'Content-Type': contentType,
      'x-upsert': 'true',
    },
    body,
    keepalive: opts.keepalive ?? false,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`upload ${res.status}: ${detail.slice(0, 120)}`);
  }
  return `${SUPA_URL}/storage/v1/object/public/${QA_BUCKET}/${path}`;
}
