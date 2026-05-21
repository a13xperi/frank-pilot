import { useEffect, useState } from 'react';
import { Camera, Check, X, Loader2, Copy } from 'lucide-react';

const STORAGE_KEY = 'frank_qa';

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

async function uploadToSupabase(blob: Blob, filename: string): Promise<string> {
  if (!SUPA_URL || !SUPA_KEY) throw new Error('Supabase storage env vars missing');
  const path = `${filename}`;
  const res = await fetch(`${SUPA_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      'Content-Type': 'image/png',
      'x-upsert': 'true',
    },
    body: blob,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`upload ${res.status}: ${detail.slice(0, 120)}`);
  }
  return `${SUPA_URL}/storage/v1/object/public/${BUCKET}/${path}`;
}

type Status = 'idle' | 'capturing' | 'uploading' | 'done' | 'error';

export function ScreenshotButton() {
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [msg, setMsg] = useState<string>('');
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  useEffect(() => { setVisible(shouldShow()); }, []);

  async function capture() {
    if (status === 'capturing' || status === 'uploading') return;
    setStatus('capturing');
    setMsg('');
    setShareUrl(null);
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

      const name = `frank-${slugFromPath()}-${timestamp()}.png`;
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      const blob = await dataUrlToBlob(dataUrl);

      let url: string | null = null;
      if (SUPA_URL && SUPA_KEY) {
        setStatus('uploading');
        setMsg('Uploading…');
        try {
          url = await uploadToSupabase(blob, name);
        } catch (err) {
          setStatus('error');
          setMsg(err instanceof Error ? err.message : 'Upload failed');
          window.setTimeout(() => { setStatus('idle'); setMsg(''); }, 4500);
          return;
        }
      }

      let clipboardText = false;
      if (url && navigator.clipboard?.writeText) {
        try { await navigator.clipboard.writeText(url); clipboardText = true; } catch { /* ignore */ }
      }

      setStatus('done');
      setShareUrl(url);
      setMsg(url ? (clipboardText ? 'URL copied' : 'Uploaded') : 'Saved');
      window.setTimeout(() => {
        setStatus('idle');
        setMsg('');
      }, url ? 15000 : 2200);
    } catch (err) {
      setStatus('error');
      setMsg(err instanceof Error ? err.message : 'Capture failed');
      window.setTimeout(() => { setStatus('idle'); setMsg(''); }, 3500);
    }
  }

  async function copyUrl() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setMsg('URL copied');
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
      {shareUrl && (
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
            gap: 4,
            wordBreak: 'break-all',
          }}
        >
          <div style={{ fontSize: 10, color: '#6b7280', fontFamily: 'system-ui, sans-serif', fontWeight: 600 }}>
            Paste this URL to Claude:
          </div>
          <div>{shareUrl}</div>
          <button
            type="button"
            onClick={copyUrl}
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
            <Copy size={11} /> Copy
          </button>
        </div>
      )}
      {msg && !shareUrl && (
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
