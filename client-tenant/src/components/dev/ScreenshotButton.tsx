import { useEffect, useState } from 'react';
import { Camera, Check, X, Loader2, Copy } from 'lucide-react';
import { getQaBuffer } from '@/lib/qaBuffer';

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

function dumpStorage(store: Storage | undefined): Record<string, string> {
  if (!store) return {};
  const out: Record<string, string> = {};
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (!k) continue;
    const v = store.getItem(k);
    if (v == null) continue;
    out[k] = k === TOKEN_KEY ? '<redacted; see auth.claims>' : v;
  }
  return out;
}

function buildDebugPayload(pngUrl: string | null): Record<string, unknown> {
  const token = (() => { try { return window.localStorage.getItem(TOKEN_KEY); } catch { return null; } })();
  const claims = token ? decodeJwtClaims(token) : null;
  return {
    capturedAt: new Date().toISOString(),
    screenshotUrl: pngUrl,
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
    qaBuffer: getQaBuffer(),
  };
}

type Status = 'idle' | 'capturing' | 'uploading' | 'done' | 'error';

type Bundle = { png: string; json: string };

function clipboardBlock(b: Bundle): string {
  return `Screenshot: ${b.png}\nDebug: ${b.json}`;
}

export function ScreenshotButton() {
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [msg, setMsg] = useState<string>('');
  const [bundle, setBundle] = useState<Bundle | null>(null);

  useEffect(() => { setVisible(shouldShow()); }, []);

  async function capture() {
    if (status === 'capturing' || status === 'uploading') return;
    setStatus('capturing');
    setMsg('');
    setBundle(null);
    try {
      const { toPng } = await import('html-to-image');
      const node = document.body;
      const dataUrl = await toPng(node, {
        cacheBust: true,
        pixelRatio: window.devicePixelRatio || 2,
        filter: (el) => {
          if (!(el instanceof HTMLElement)) return true;
          return el.dataset?.screenshotExclude !== '1';
        },
      });

      const stem = `frank-${slugFromPath()}-${timestamp()}`;
      const pngName = `${stem}.png`;
      const jsonName = `${stem}.json`;

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

      const debugPayload = buildDebugPayload(pngUrl);
      let jsonUrl: string;
      try {
        jsonUrl = await uploadToSupabase(JSON.stringify(debugPayload, null, 2), jsonName, 'application/json');
      } catch (err) {
        setStatus('error');
        setMsg(err instanceof Error ? `Debug upload failed: ${err.message}` : 'Debug upload failed');
        window.setTimeout(() => { setStatus('idle'); setMsg(''); }, 4500);
        return;
      }

      const next: Bundle = { png: pngUrl, json: jsonUrl };
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
        right: 16,
        bottom: 16,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
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
