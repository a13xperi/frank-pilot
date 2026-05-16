// Desktop-only demo shell — sibling of phone-shell. Same layout as the full
// demo-shell but the timeline is filtered to ONLY desktop screens.

window.__UH_PHONE_NATIVE__ = false;

const DTL = (window.DEMO_TIMELINE || []).filter(s => s.desktop);

function DesktopDemo() {
  const [idx, setIdx] = React.useState(() => {
    const hash = window.location.hash.replace('#', '');
    const found = DTL.findIndex(s => s.id === hash);
    return found >= 0 ? found : 0;
  });
  const [sidebarOpen, setSidebarOpen] = React.useState(true);
  const screen = DTL[idx];
  const total = DTL.length;

  React.useEffect(() => { if (screen) window.location.hash = screen.id; }, [screen]);
  React.useEffect(() => {
    function onKey(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowRight' || e.key === 'j') setIdx(i => Math.min(total - 1, i + 1));
      if (e.key === 'ArrowLeft'  || e.key === 'k') setIdx(i => Math.max(0, i - 1));
      if (e.key === '/' || e.key === 'f') { e.preventDefault(); setSidebarOpen(o => !o); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [total]);

  if (!screen) return <div style={{ padding: 40 }}>Loading…</div>;
  const Comp = window[screen.comp];
  const acts = [...new Set(DTL.map(s => s.act))];

  return (
    <div style={{
      minHeight: '100vh', background: '#F4EFE5',
      display: 'grid',
      gridTemplateColumns: sidebarOpen ? '320px 1fr' : '60px 1fr',
      transition: 'grid-template-columns .25s',
    }}>
      <aside style={{
        background: HF.paper, borderRight: `1px solid ${HF.border}`,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{
          padding: '14px 16px', borderBottom: `1px solid ${HF.border}`,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: HF.r.sm,
            background: HF.accent, color: HF.paper,
            display: 'grid', placeItems: 'center',
            fontFamily: HF.display, fontWeight: 800, fontSize: 15, flex: '0 0 32px',
          }}>U</div>
          {sidebarOpen && (
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontFamily: HF.display, fontSize: 14, fontWeight: 700,
                color: HF.ink, letterSpacing: '-0.01em',
              }}>Universal Housing</div>
              <div style={{ fontFamily: HF.body, fontSize: 11, color: HF.ink3 }}>
                Desktop demo · {total} screens
              </div>
            </div>
          )}
          <button onClick={() => setSidebarOpen(o => !o)} style={{
            width: 28, height: 28, borderRadius: HF.r.sm, border: 'none',
            background: HF.cream, color: HF.ink2, cursor: 'pointer',
            display: 'grid', placeItems: 'center', fontSize: 14, fontWeight: 700,
            flex: '0 0 28px',
          }}>{sidebarOpen ? '‹' : '›'}</button>
        </div>

        {sidebarOpen && (
          <div style={{ flex: 1, overflow: 'auto', padding: '8px 8px 24px' }}>
            {acts.map(actName => (
              <div key={actName} style={{ marginTop: 12 }}>
                <div style={{
                  padding: '4px 12px',
                  fontFamily: HF.body, fontSize: 10, fontWeight: 700, color: HF.ink3,
                  textTransform: 'uppercase', letterSpacing: '0.08em',
                }}>{actName}</div>
                {DTL.filter(s => s.act === actName).map(s => {
                  const sIdx = DTL.indexOf(s);
                  const isActive = sIdx === idx;
                  return (
                    <button
                      key={s.id}
                      onClick={() => setIdx(sIdx)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        width: '100%', textAlign: 'left',
                        padding: '8px 12px', borderRadius: HF.r.sm,
                        background: isActive ? HF.accentLo : 'transparent',
                        border: 'none', cursor: 'pointer',
                        marginTop: 2, color: HF.ink,
                      }}>
                      <span style={{
                        width: 22, height: 22, borderRadius: HF.r.pill, flex: '0 0 22px',
                        background: isActive ? HF.accent : HF.cream,
                        color: isActive ? HF.paper : HF.ink3,
                        display: 'grid', placeItems: 'center',
                        fontFamily: HF.body, fontWeight: 700, fontSize: 10,
                      }}>{sIdx + 1}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontFamily: HF.body, fontSize: 12, fontWeight: isActive ? 700 : 500,
                          color: isActive ? HF.accent : HF.ink, lineHeight: 1.3,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>{s.label}</div>
                        <div style={{ fontSize: 10, color: HF.ink3, marginTop: 1,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>{s.sub}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        {sidebarOpen && (
          <div style={{
            padding: '10px 14px', borderTop: `1px solid ${HF.border}`,
            fontFamily: HF.body, fontSize: 10, color: HF.ink3, lineHeight: 1.6,
          }}>
            <div><b>← →</b> navigate · <b>/</b> toggle sidebar</div>
            <div style={{ marginTop: 6 }}>Share: copy URL with #screen-id</div>
          </div>
        )}
      </aside>

      <main style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{
          padding: '14px 32px', borderBottom: `1px solid ${HF.border}`,
          background: HF.paper, display: 'flex', alignItems: 'center', gap: 16,
        }}>
          <div style={{
            padding: '4px 10px', borderRadius: HF.r.pill,
            background: HF.cream, fontFamily: HF.body, fontSize: 11, fontWeight: 700,
            color: HF.ink3, textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>{screen.act}</div>
          <H2 style={{ fontSize: 20, flex: 1, lineHeight: 1.2, minWidth: 0,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{screen.label}</H2>
          <div style={{
            fontFamily: HF.body, fontSize: 12, fontWeight: 500, color: HF.ink3,
            fontVariantNumeric: 'tabular-nums',
          }}>{idx + 1} / {total}</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <Button variant="secondary" size="sm" onClick={() => setIdx(Math.max(0, idx - 1))}>← Prev</Button>
            <Button variant="primary" size="sm" onClick={() => setIdx(Math.min(total - 1, idx + 1))}>Next →</Button>
          </div>
        </div>

        <div style={{
          flex: 1, padding: '28px 32px', overflow: 'auto',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        }}>
          {screen.comp === 'PersonaIntro' ? (
            <Comp />
          ) : (
            <div style={{
              width: '100%', maxWidth: 1440, minHeight: screen.desktopH || 1100,
              background: HF.paper, borderRadius: HF.r.lg, overflow: 'hidden',
              boxShadow: HF.shadow.md, border: `1px solid ${HF.border}`,
            }}>
              <Comp />
            </div>
          )}
        </div>

        <div style={{
          background: HF.paper, borderTop: `1px solid ${HF.border}`, padding: '10px 32px',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            fontFamily: HF.body, fontSize: 11, color: HF.ink3,
          }}>
            <div style={{ flex: 1, height: 4, background: HF.cream, borderRadius: 99, overflow: 'hidden' }}>
              <div style={{
                width: `${((idx + 1) / total) * 100}%`, height: '100%',
                background: HF.accent, transition: 'width .25s',
              }} />
            </div>
            <span style={{ whiteSpace: 'nowrap' }}>{screen.sub}</span>
          </div>
        </div>
      </main>
    </div>
  );
}

window.DesktopDemo = DesktopDemo;

ReactDOM.createRoot(document.getElementById('root')).render(<DesktopDemo />);
