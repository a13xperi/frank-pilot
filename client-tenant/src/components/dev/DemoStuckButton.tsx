import { useEffect, useState } from 'react';
import { HelpCircle, Check } from 'lucide-react';
import { isDemoMode } from '@/lib/demoSession';
import { logDemoEvent } from '@/lib/demoCapture';

// "I'm stuck" marker for usability walkthroughs. Visible only inside a
// `?demo=<TOKEN>` session. A tester taps it the moment they feel lost; we
// stamp a `stuck` event (route + optional note) into the demo event log so a
// reviewer can jump straight to the friction point in the session replay.
//
// data-screenshot-exclude / rr-block keep the widget itself out of captures.
export function DemoStuckButton() {
  const [show, setShow] = useState(false);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [sent, setSent] = useState(false);

  useEffect(() => {
    setShow(isDemoMode());
  }, []);

  if (!show) return null;

  function submit() {
    logDemoEvent('stuck', { note: note.trim() || null });
    setSent(true);
    setNote('');
    setOpen(false);
    window.setTimeout(() => setSent(false), 2200);
  }

  return (
    <div
      data-screenshot-exclude="1"
      className="rr-block"
      style={{
        position: 'fixed',
        left: 16,
        bottom: 16,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 8,
      }}
    >
      {open && (
        <div
          style={{
            background: 'white',
            border: '1px solid #d1d5db',
            borderRadius: 10,
            padding: 12,
            width: 240,
            boxShadow: '0 6px 20px rgba(0,0,0,0.18)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>
            What's confusing here?
          </div>
          <textarea
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional — what are you stuck on?"
            rows={3}
            data-pii
            style={{
              fontSize: 13,
              padding: 8,
              border: '1px solid #d1d5db',
              borderRadius: 6,
              resize: 'none',
              fontFamily: 'inherit',
            }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={submit}
              style={{
                flex: 1,
                fontSize: 13,
                padding: '6px 10px',
                border: 'none',
                borderRadius: 6,
                background: '#b45309',
                color: 'white',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              Send
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{
                fontSize: 13,
                padding: '6px 10px',
                border: '1px solid #d1d5db',
                borderRadius: 6,
                background: '#f9fafb',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      <button
        type="button"
        aria-label="Mark that you're stuck"
        onClick={() => (sent ? null : setOpen((v) => !v))}
        style={{
          height: 40,
          padding: '0 14px',
          borderRadius: 20,
          border: 'none',
          background: sent ? '#059669' : '#b45309',
          color: 'white',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
          boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
        }}
      >
        {sent ? <Check size={16} /> : <HelpCircle size={16} />}
        {sent ? 'Got it' : "I'm stuck"}
      </button>
    </div>
  );
}
