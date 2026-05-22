// Rolling buffer of recent fetch calls + JS errors, drained by the dev
// ScreenshotButton into the debug JSON sidecar. Install once from main.tsx
// (no-op if installed twice). Best-effort capture; never throws.

const MAX_ENTRIES = 25;

export type QaFetchEntry = {
  kind: 'fetch';
  t: string;
  method: string;
  url: string;
  status: number | null;
  ok: boolean | null;
  durationMs: number;
  error?: string;
};

export type QaErrorEntry = {
  kind: 'error' | 'unhandledrejection';
  t: string;
  message: string;
  source?: string;
  line?: number;
  col?: number;
  stack?: string;
};

export type QaEntry = QaFetchEntry | QaErrorEntry;

const buf: QaEntry[] = [];

// Drop fetch entries that are clearly noise so the 25-entry window is reserved
// for real app traffic (API calls, magic-link, payment, etc). Covers:
//   - Vite HMR / module loading (/@vite/, /@id/, /__vite_ping, /node_modules/)
//   - Built static assets (/assets/*.{js,css,map,woff,woff2,ttf,png,svg,jpg})
//   - Cross-origin font CDNs (fonts.googleapis.com, fonts.gstatic.com)
//   - Self-uploads to the QA screenshot bucket (would otherwise self-poison
//     the buffer on every camera click).
const NOISE_PATTERNS: RegExp[] = [
  /\/@vite\//,
  /\/@id\//,
  /\/__vite_ping/,
  /\/node_modules\//,
  /\/assets\/[^?]+\.(?:js|css|map|woff2?|ttf|otf|eot|png|svg|jpg|jpeg|gif|webp|ico)(?:\?|$)/i,
  /fonts\.(?:googleapis|gstatic)\.com/i,
  /\/storage\/v1\/object\/(?:public\/)?frank-qa-screenshots\//,
];

function isNoise(url: string): boolean {
  return NOISE_PATTERNS.some((re) => re.test(url));
}

function push(entry: QaEntry): void {
  if (entry.kind === 'fetch' && isNoise(entry.url)) return;
  buf.push(entry);
  if (buf.length > MAX_ENTRIES) buf.splice(0, buf.length - MAX_ENTRIES);
}

export function getQaBuffer(): QaEntry[] {
  return buf.slice();
}

export function clearQaBuffer(): void {
  buf.length = 0;
}

let installed = false;

export function installQaBuffer(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  const origFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const start = performance.now();
    const method = (init?.method || (typeof input === 'object' && 'method' in input ? input.method : 'GET') || 'GET').toUpperCase();
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    try {
      const res = await origFetch(input, init);
      push({ kind: 'fetch', t: new Date().toISOString(), method, url, status: res.status, ok: res.ok, durationMs: Math.round(performance.now() - start) });
      return res;
    } catch (err) {
      push({ kind: 'fetch', t: new Date().toISOString(), method, url, status: null, ok: null, durationMs: Math.round(performance.now() - start), error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  };

  window.addEventListener('error', (e) => {
    push({
      kind: 'error',
      t: new Date().toISOString(),
      message: e.message || 'unknown',
      source: e.filename,
      line: e.lineno,
      col: e.colno,
      stack: e.error instanceof Error ? e.error.stack : undefined,
    });
  });

  window.addEventListener('unhandledrejection', (e) => {
    const reason: unknown = e.reason;
    const message = reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : 'unhandledrejection';
    push({
      kind: 'unhandledrejection',
      t: new Date().toISOString(),
      message,
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });
}
