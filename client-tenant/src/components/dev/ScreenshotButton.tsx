import { useEffect, useState } from 'react';
import { Camera, Check, X, Loader2, Copy } from 'lucide-react';
import { getQaBuffer, clearQaBuffer, type QaEntry } from '@/lib/qaBuffer';
import {
  installQaReplay,
  getQaReplayEvents,
  clearQaReplay,
  stopQaReplay,
} from '@/lib/qaSessionReplay';

function replayEnabled(): boolean {
  return import.meta.env.DEV || import.meta.env.VITE_QA_SESSION_REPLAY_ENABLED === 'true';
}

const STORAGE_KEY = 'frank_qa';
const TOKEN_KEY = 'frank_tenant_token';

const SUPA_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPA_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
const BUCKET = 'frank-qa-screenshots';

function shouldShow(): boolean {
  if (import.meta.env.DEV) return true;
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get('qa') === '1') {
    try { window.localStorage.setItem(STORAGE_KEY, '1'); } catch { /* ignore */ }
    return true;
  }
  if (params.get('qa') === '0') {
    try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    return false;
  }
  try { return window.localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function slugFromPath(): string {
  if (typeof window === 'undefined') return 'page';
  const path = window.location.pathname.replace(/^\/+|\/+$/g, '');
  return path ? path.replace(/\//g, '-') : 'home';
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  return (await fetch(dataUrl)).blob();
}

async function uploadToSupabase(body: BodyInit, filename: string, contentType: string): Promise<string> {
  if (!SUPA_URL || !SUPA_KEY) throw new Error('Supabase storage env vars missing');
  const res = await fetch(`${SUPA_URL}/storage/v1/object/${BUCKET}/${filename}`, {
    method: 'POST',
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      'Content-Type': contentType,
      'x-upsert': 'true',
    },
    body,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`upload ${res.status}: ${detail.slice(0, 120)}`);
  }
  return `${SUPA_URL}/storage/v1/object/public/${BUCKET}/${filename}`;
}

function decodeJwtClaims(token: string): Record<string, unknown> | null {
  try {
    const mid = token.split('.')[1];
    if (!mid) return null;
    const padded = mid.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((mid.length + 3) % 4);
    return JSON.parse(atob(padded));
  } catch { return null; }
}

// Allowlist of storage keys we know are safe to dump. Unknown keys are
// dropped silently rather than emitted, to avoid leaking PII or 3rd-party
// data (e.g. analytics blobs) into the debug bundle. Update when the app
// starts using a new key worth seeing.
const STORAGE_ALLOWLIST: ReadonlyArray<string | RegExp> = [
  TOKEN_KEY,
  STORAGE_KEY,
  'i18nextLng',
  'fp.consent.v1',
  'pendingEmail',
  /^frank_/,
];

function isAllowedStorageKey(key: string): boolean {
  return STORAGE_ALLOWLIST.some((m) => (typeof m === 'string' ? m === key : m.test(key)));
}

function dumpStorage(store: Storage | undefined): Record<string, string> {
  if (!store) return {};
  const out: Record<string, string> = {};
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (!k || !isAllowedStorageKey(k)) continue;
    const v = store.getItem(k);
    if (v == null) continue;
    out[k] = k === TOKEN_KEY ? '<redacted; see auth.claims>' : v;
  }
  return out;
}

function buildDebugPayload(
  pngUrl: string | null,
  replayUrl: string | null,
  qaBufferSnapshot: QaEntry[],
): Record<string, unknown> {
  const token = (() => { try { return window.localStorage.getItem(TOKEN_KEY); } catch { return null; } })();
  const claims = token ? decodeJwtClaims(token) : null;
  return {
    capturedAt: new Date().toISOString(),
    screenshotUrl: pngUrl,
    replayUrl,
    url: {
      href: window.location.href,
      pathname: window.location.pathname,
      search: window.location.search,
      hash: window.location.hash,
      referrer: document.referrer || null,
    },
    viewport: {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      userAgent: navigator.userAgent,
      language: navigator.language,
    },
    auth: {
      hasToken: Boolean(token),
      claims,
    },
    flags: {
      VITE_PAYMENT_WIZARD_ENABLED: import.meta.env.VITE_PAYMENT_WIZARD_ENABLED ?? null,
      VITE_PROPERTY_DL2_ENABLED: import.meta.env.VITE_PROPERTY_DL2_ENABLED ?? null,
      VITE_MOBILE_APPLY_ENABLED: import.meta.env.VITE_MOBILE_APPLY_ENABLED ?? null,
      MODE: import.meta.env.MODE,
      DEV: import.meta.env.DEV,
    },
    storage: {
      localStorage: dumpStorage(typeof window !== 'undefined' ? window.localStorage : undefined),
      sessionStorage: dumpStorage(typeof window !== 'undefined' ? window.sessionStorage : undefined),
    },
    qaBuffer: qaBufferSnapshot,
  };
}

type Status = 'idle' | 'capturing' | 'uploading' | 'done' | 'error';

type Bundle = { png: string; json: string; replay: string | null };

function clipboardBlock(b: Bundle): string {
  const lines = [`Screenshot: ${b.png}`, `Debug: ${b.json}`];
  if (b.replay) lines.push(`Replay: ${b.replay}`);
  return lines.join('\n');
}

export function ScreenshotButton() {
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [msg, setMsg] = useState<string>('');
  const [bundle, setBundle] = useState<Bundle | null>(null);

  useEffect(() => { setVisible(shouldShow()); }, []);

  useEffect(() => {
    if (!visible || !replayEnabled()) return;
    void installQaReplay();
  }, [visible]);

  async function capture() {
    if (status === 'capturing' || status === 'uploading') return;
    setStatus('capturing');
    setMsg('');
    setBundle(null);
    try {
      // Snapshot the qaBuffer BEFORE toPng() runs — html-to-image inlines fonts
      // by fetching them, which would otherwise flood the 25-entry buffer and
      // push real app traffic out. Then clear so the next camera click starts
      // fresh and doesn't inherit this click's font-fetch + self-upload noise.
      const qaSnapshot = getQaBuffer();
      clearQaBuffer();

      // Same idea for the rrweb buffer — stop the recorder BEFORE toPng() so
      // its DOM-clone mutations aren't logged as events. Snapshot + clear,
      // then re-install after toPng() returns so the next click captures
      // fresh activity.
      stopQaReplay();
      const replaySnapshot = getQaReplayEvents();
      clearQaReplay();

      const { toPng } = await import('html-to-image');
      const node = document.body;
      // skipFonts: cross-origin Google Fonts stylesheets block cssRules access
      // and spam two SecurityError lines per capture; we render with system
      // fonts instead. pixelRatio: 1 keeps QA PNGs ~75KB on retina (vs ~280KB
      // at the device 2x) — plenty for visual review.
      const dataUrl = await toPng(node, {
        cacheBust: true,
        pixelRatio: 1,
        skipFonts: true,
        filter: (el) => {
          if (!(el instanceof HTMLElement)) return true;
          return el.dataset?.screenshotExclude !== '1';
        },
      });

      // Re-install the recorder now that toPng() has finished walking the DOM.
      // Fire-and-forget — best-effort; we don't want to delay the upload.
      if (replayEnabled()) void installQaReplay();

      const stem = `frank-${slugFromPath()}-${timestamp()}`;
      const pngName = `${stem}.png`;
      const jsonName = `${stem}.json`;
      const replayName = `${stem}.replay.json`;

      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = pngName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      const pngBlob = await dataUrlToBlob(dataUrl);

      if (!SUPA_URL || !SUPA_KEY) {
        setStatus('done');
        setMsg('Saved (no Supabase env)');
        window.setTimeout(() => { setStatus('idle'); setMsg(''); }, 2200);
        return;
      }

      setStatus('uploading');
      setMsg('Uploading…');

      let pngUrl: string;
      try {
        pngUrl = await uploadToSupabase(pngBlob, pngName, 'image/png');
      } catch (err) {
        setStatus('error');
        setMsg(err instanceof Error ? err.message : 'PNG upload failed');
        window.setTimeout(() => { setStatus('idle'); setMsg(''); }, 4500);
        return;
      }

      // Replay is best-effort: skip when empty, swallow upload failures so a
      // broken rrweb upload never blocks the JSON sidecar (which is the most
      // valuable file for Claude).
      let replayUrl: string | null = null;
      if (replaySnapshot.length > 0) {
        try {
          replayUrl = await uploadToSupabase(
            JSON.stringify(replaySnapshot),
            replayName,
            'application/json',
          );
        } catch {
          replayUrl = null;
        }
      }

      const debugPayload = buildDebugPayload(pngUrl, replayUrl, qaSnapshot);
      let jsonUrl: string;
      try {
        jsonUrl = await uploadToSupabase(JSON.stringify(debugPayload, null, 2), jsonName, 'application/json');
      } catch (err) {
        setStatus('error');
        setMsg(err instanceof Error ? `Debug upload failed: ${err.message}` : 'Debug upload failed');
        window.setTimeout(() => { setStatus('idle'); setMsg(''); }, 4500);
        return;
      }

      const next: Bundle = { png: pngUrl, json: jsonUrl, replay: replayUrl };
      let copied = false;
      if (navigator.clipboard?.writeText) {
        try { await navigator.clipboard.writeText(clipboardBlock(next)); copied = true; } catch { /* ignore */ }
      }

      setStatus('done');
      setBundle(next);
      setMsg(copied ? 'URLs copied' : 'Uploaded');
      window.setTimeout(() => { setStatus('idle'); setMsg(''); }, 15000);
    } catch (err) {
      setStatus('error');
      setMsg(err instanceof Error ? err.message : 'Capture failed');
      window.setTimeout(() => { setStatus('idle'); setMsg(''); }, 3500);
    }
  }

  async function copyBoth() {
    if (!bundle) return;
    try {
      await navigator.clipboard.writeText(clipboardBlock(bundle));
      setMsg('URLs copied');
    } catch {
      setMsg('Copy failed');
    }
  }

  if (!visible) return null;

  return (
    <div
      data-screenshot-exclude="1"
      style={{
        position: 'fixed',
        // Bottom-LEFT, away from the housing chat widget (right:20, bottom:20)
        // — at right/bottom:16 this z-9999 overlay sat on top of the chat
        // bubble and swallowed its clicks in dev mode.
        left: 16,
        bottom: 16,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 6,
        pointerEvents: 'auto',
        maxWidth: 380,
      }}
    >
      {bundle && (
        <div
          style={{
            background: 'white',
            border: '1px solid #d1d5db',
            borderRadius: 8,
            padding: '8px 10px',
            fontSize: 11,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            wordBreak: 'break-all',
          }}
        >
          <div style={{ fontSize: 10, color: '#6b7280', fontFamily: 'system-ui, sans-serif', fontWeight: 600 }}>
            Paste both URLs to Claude:
          </div>
          <div><span style={{ color: '#6b7280' }}>PNG:</span> {bundle.png}</div>
          <div><span style={{ color: '#6b7280' }}>JSON:</span> {bundle.json}</div>
          {bundle.replay && (
            <div><span style={{ color: '#6b7280' }}>Replay:</span> {bundle.replay}</div>
          )}
          <button
            type="button"
            onClick={copyBoth}
            style={{
              alignSelf: 'flex-start',
              marginTop: 2,
              fontSize: 11,
              padding: '3px 8px',
              border: '1px solid #d1d5db',
              borderRadius: 4,
              background: '#f9fafb',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <Copy size={11} /> Copy both
          </button>
        </div>
      )}
      {msg && !bundle && (
        <div
          style={{
            background: status === 'error' ? '#7f1d1d' : '#064e3b',
            color: 'white',
            fontSize: 12,
            padding: '4px 8px',
            borderRadius: 6,
            boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
          }}
        >
          {msg}
        </div>
      )}
      <button
        type="button"
        aria-label="Take screenshot for QA review"
        onClick={capture}
        disabled={status === 'capturing' || status === 'uploading'}
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          border: 'none',
          background: status === 'error' ? '#dc2626' : status === 'done' ? '#059669' : '#111827',
          color: 'white',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: status === 'capturing' || status === 'uploading' ? 'wait' : 'pointer',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          opacity: status === 'capturing' || status === 'uploading' ? 0.85 : 1,
        }}
      >
        {(status === 'capturing' || status === 'uploading') && <Loader2 size={20} className="animate-spin" />}
        {status === 'done' && <Check size={20} />}
        {status === 'error' && <X size={20} />}
        {status === 'idle' && <Camera size={20} />}
      </button>
    </div>
  );
}
