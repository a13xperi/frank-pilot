import { useEffect, useMemo, useState } from 'react';
import { onApiEvent, type ApiEvent } from '@/api/client';
import { STEPS, THIS_OWNER } from '@/lib/demoSteps';

// Live narration overlay for the 16-step onboarding demo (see
// scripts/demo-onboarding-end-to-end.sh). Mounted only when the URL carries
// `?demo=` — a no-op for normal browsing. Each tab's overlay only lights the
// steps owned by its app (THIS_OWNER); other-owner rows stay dim so the
// stakeholder watching live sees the full chain context.

function useDemoEnabled(): boolean {
  return useMemo(() => {
    if (typeof window === 'undefined') return false;
    const sp = new URLSearchParams(window.location.search);
    return sp.has('demo');
  }, []);
}

export function DemoOverlay() {
  const enabled = useDemoEnabled();
  const [done, setDone] = useState<Set<number>>(() => new Set());
  const [current, setCurrent] = useState<number | null>(null);
  const [recent, setRecent] = useState<ApiEvent[]>([]);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    return onApiEvent((e) => {
      setRecent((prev) => [e, ...prev].slice(0, 4));
      const match = STEPS.find((s) => s.match(e));
      if (!match) return;
      setDone((prev) => {
        const next = new Set(prev);
        next.add(match.n);
        return next;
      });
      setCurrent(match.n);
    });
  }, [enabled]);

  if (!enabled || dismissed) return null;

  const total = STEPS.length;
  const completed = done.size;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 12,
        left: 12,
        width: 340,
        maxHeight: '70vh',
        background: 'rgba(15, 17, 21, 0.92)',
        color: '#e6edf3',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 8,
        padding: '10px 12px',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: 11,
        lineHeight: 1.4,
        zIndex: 99999,
        boxShadow: '0 10px 30px rgba(0,0,0,0.45)',
        backdropFilter: 'blur(6px)',
        pointerEvents: 'auto',
      }}
      data-testid="demo-overlay"
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontWeight: 600, fontSize: 11, letterSpacing: 0.3 }}>
          Frank-Pilot · Onboarding Demo
        </div>
        <button
          onClick={() => setDismissed(true)}
          aria-label="Dismiss demo overlay"
          style={{
            background: 'transparent',
            color: '#8b949e',
            border: 'none',
            cursor: 'pointer',
            fontSize: 14,
            lineHeight: 1,
            padding: 0,
          }}
        >
          ×
        </button>
      </div>
      <div style={{ color: '#8b949e', marginBottom: 6 }}>
        Step {completed} / {total} · {THIS_OWNER} tab
      </div>
      <div style={{ maxHeight: 280, overflowY: 'auto', paddingRight: 4 }}>
        {STEPS.map((s) => {
          const isDone = done.has(s.n);
          const isCurrent = current === s.n;
          const isMine = s.owner === THIS_OWNER;
          const glyph = isDone ? '✓' : isCurrent ? '▶' : '·';
          const color = isDone
            ? '#3fb950'
            : isCurrent
              ? '#d29922'
              : isMine
                ? '#c9d1d9'
                : '#484f58';
          return (
            <div
              key={s.n}
              style={{
                display: 'flex',
                gap: 8,
                color,
                opacity: isMine ? 1 : 0.55,
                padding: '1px 0',
              }}
            >
              <span style={{ width: 14, textAlign: 'right', color: '#6e7681' }}>{s.n}</span>
              <span style={{ width: 10, textAlign: 'center' }}>{glyph}</span>
              <span style={{ flex: 1 }}>{s.label}</span>
              <span style={{ color: '#6e7681', fontSize: 10 }}>{s.owner === 'tenant' ? 'T' : 'S'}</span>
            </div>
          );
        })}
      </div>
      {recent.length > 0 && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ color: '#6e7681', marginBottom: 4 }}>recent calls</div>
          {recent.map((e, i) => {
            const color = e.ok ? '#3fb950' : e.status >= 400 ? '#f85149' : '#d29922';
            return (
              <div
                key={`${e.ts}-${i}`}
                style={{
                  display: 'flex',
                  gap: 6,
                  color: '#c9d1d9',
                  fontSize: 10,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={`${e.method} ${e.path}`}
              >
                <span style={{ color: '#8b949e', width: 38 }}>{e.method}</span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.path}</span>
                <span style={{ color, width: 28, textAlign: 'right' }}>{e.status}</span>
                <span style={{ color: '#6e7681', width: 40, textAlign: 'right' }}>{e.durationMs}ms</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
