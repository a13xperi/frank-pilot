import { useEffect, useState } from 'react';
import { Camera, Check, X, Loader2 } from 'lucide-react';

const STORAGE_KEY = 'frank_qa';

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

type Status = 'idle' | 'capturing' | 'done' | 'error';

export function ScreenshotButton() {
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [msg, setMsg] = useState<string>('');

  useEffect(() => { setVisible(shouldShow()); }, []);

  async function capture() {
    if (status === 'capturing') return;
    setStatus('capturing');
    setMsg('');
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

      let clipboardOk = false;
      try {
        const blob = await (await fetch(dataUrl)).blob();
        if (navigator.clipboard && 'write' in navigator.clipboard && typeof ClipboardItem !== 'undefined') {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          clipboardOk = true;
        }
      } catch { /* clipboard may be blocked in non-secure or unsupported browsers */ }

      setStatus('done');
      setMsg(clipboardOk ? 'Saved + copied' : 'Saved');
      window.setTimeout(() => { setStatus('idle'); setMsg(''); }, 2200);
    } catch (err) {
      setStatus('error');
      setMsg(err instanceof Error ? err.message : 'Capture failed');
      window.setTimeout(() => { setStatus('idle'); setMsg(''); }, 3500);
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
      }}
    >
      {msg && (
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
        disabled={status === 'capturing'}
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
          cursor: status === 'capturing' ? 'wait' : 'pointer',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          opacity: status === 'capturing' ? 0.85 : 1,
        }}
      >
        {status === 'capturing' && <Loader2 size={20} className="animate-spin" />}
        {status === 'done' && <Check size={20} />}
        {status === 'error' && <X size={20} />}
        {status === 'idle' && <Camera size={20} />}
      </button>
    </div>
  );
}
