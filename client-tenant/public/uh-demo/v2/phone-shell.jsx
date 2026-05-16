// Phone-native demo shell. Same timeline as the desktop demo, but renders
// each screen full-bleed for an actual phone viewport — no fake bezel.
// Use ← → buttons, a tap-anywhere overlay, or swipe gestures.

window.__UH_PHONE_NATIVE__ = true;

// Reuse the same timeline declared in demo-shell, but filter out any
// desktop-only screens — this is the mobile-only experience.
const TL = (window.DEMO_TIMELINE || []).filter(s => !s.desktop);

function PhoneDemo() {
  const [idx, setIdx] = React.useState(() => {
    const hash = window.location.hash.replace('#', '');
    const found = TL.findIndex(s => s.id === hash);
    return found >= 0 ? found : 1; // skip persona intro (desktop-y)
  });
  const [menuOpen, setMenuOpen] = React.useState(false);
  const screen = TL[idx];
  const total = TL.length;

  React.useEffect(() => {
    if (screen) window.location.hash = screen.id;
  }, [screen]);

  // Expose a global jump function for in-screen nav (TenantNav, etc.)
  React.useEffect(() => {
    window.__UH_GO_TO__ = function (id) {
      const i = TL.findIndex(s => s.id === id);
      if (i >= 0) setIdx(i);
    };
    return () => { delete window.__UH_GO_TO__; };
  }, []);

  // Swipe gestures
  const touchRef = React.useRef({ x: 0, y: 0 });
  function onTouchStart(e) { touchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }
  function onTouchEnd(e) {
    const dx = e.changedTouches[0].clientX - touchRef.current.x;
    const dy = e.changedTouches[0].clientY - touchRef.current.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0) setIdx(i => Math.min(total - 1, i + 1));
      else setIdx(i => Math.max(0, i - 1));
    }
  }

  // Click-anywhere-on-a-button advances to the next screen. This makes the
  // demo feel "wired up" without writing per-screen routing — every CTA,
  // Surface-styled card, or interactive control just works as forward navigation.
  function isButtonish(el) {
    let n = el;
    let hops = 0;
    while (n && n.nodeType === 1 && hops < 8) {
      const tag = n.tagName;
      if (tag === 'BUTTON' || tag === 'A') return true;
      const role = n.getAttribute && n.getAttribute('role');
      if (role === 'button') return true;
      const cursor = n.style && n.style.cursor;
      if (cursor === 'pointer') return true;
      // Heuristic: chunky pill / rounded element with accent or solid bg
      const bg = n.style && n.style.background;
      const br = n.style && n.style.borderRadius;
      if (bg && (bg.includes('#C9492A') || bg.includes('#3F7A3A') || bg.includes('rgba'))
          && br && (br.includes('px') || br.includes('999'))) {
        // Only treat as a CTA if it has decent height (avoid tiny chips)
        const rect = n.getBoundingClientRect && n.getBoundingClientRect();
        if (rect && rect.height >= 28 && rect.height <= 80) return true;
      }
      n = n.parentNode;
      hops++;
    }
    return false;
  }

  function onStageClick(e) {
    // Skip if the top bar's own controls or menu fired the event
    if (e.target.closest('[data-uh-nav="true"]')) return;
    if (e.target.closest('[data-uh-menu="true"]')) return;
    // Skip if this button has its own explicit routing — handled by its onClick
    if (e.target.closest('[data-uh-routed="true"]')) return;
    if (isButtonish(e.target)) {
      // Visual feedback — quick flash on the tapped element
      const t = e.target.closest('button,a,[role="button"]') || e.target;
      if (t && t.style) {
        const prev = t.style.transform;
        t.style.transform = 'scale(0.97)';
        setTimeout(() => { t.style.transform = prev || ''; }, 120);
      }
      setIdx(i => Math.min(total - 1, i + 1));
    }
  }

  if (!screen) {
    return <div style={{ padding: 40, fontFamily: HF.body }}>Loading screens…</div>;
  }

  const Comp = window[screen.comp];

  return (
    <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}
      style={{
        minHeight: '100vh', background: HF.cream,
        display: 'flex', flexDirection: 'column',
      }}>

      {/* Top mini-bar — pinned, low-profile */}
      <div data-uh-nav="true" style={{
        position: 'sticky', top: 0, zIndex: 50,
        padding: '6px 12px 6px',
        background: 'rgba(251, 247, 240, 0.92)',
        backdropFilter: 'blur(10px)',
        borderBottom: `1px solid ${HF.border}`,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <button onClick={() => setMenuOpen(true)} style={{
          flex: 1, minWidth: 0, padding: '6px 12px', borderRadius: HF.r.pill,
          background: HF.paper, color: HF.ink, border: 'none', cursor: 'pointer',
          textAlign: 'left', boxShadow: HF.shadow.xs,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{
            padding: '2px 7px', borderRadius: HF.r.sm, background: HF.accentLo, color: HF.accent,
            fontFamily: HF.body, fontWeight: 700, fontSize: 9, letterSpacing: '0.05em',
            textTransform: 'uppercase', flex: '0 0 auto',
          }}>{screen.act}</span>
          <span style={{
            flex: 1, minWidth: 0, fontFamily: HF.body, fontSize: 12, fontWeight: 600, color: HF.ink,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{screen.label}</span>
          <span style={{
            fontFamily: HF.body, fontSize: 10, color: HF.ink3,
            fontVariantNumeric: 'tabular-nums', flex: '0 0 auto',
          }}>{idx + 1}/{total}</span>
        </button>
      </div>

      {/* Progress sliver */}
      <div style={{
        height: 2, background: HF.cream,
        position: 'sticky', top: 46, zIndex: 49,
      }}>
        <div style={{
          width: `${((idx + 1) / total) * 100}%`, height: '100%',
          background: HF.accent, transition: 'width .25s',
        }} />
      </div>

      {/* Fixed bottom navigation — always visible */}
      <div data-uh-nav="true" style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 60,
        padding: `10px 12px calc(10px + env(safe-area-inset-bottom, 0px))`,
        background: 'rgba(251, 247, 240, 0.96)',
        backdropFilter: 'blur(14px)',
        borderTop: `1px solid ${HF.border}`,
        display: 'flex', alignItems: 'center', gap: 10,
        boxShadow: '0 -8px 24px rgba(31,26,18,0.06)',
      }}>
        <button onClick={() => setIdx(i => Math.max(0, i - 1))} disabled={idx === 0} style={{
          width: 48, height: 48, borderRadius: HF.r.pill, border: 'none',
          background: HF.paper, color: HF.ink, cursor: 'pointer',
          display: 'grid', placeItems: 'center', fontSize: 22, fontWeight: 700,
          opacity: idx === 0 ? 0.4 : 1, flex: '0 0 48px',
          boxShadow: HF.shadow.sm,
        }}>‹</button>
        <button onClick={() => setMenuOpen(true)} style={{
          flex: 1, height: 48, borderRadius: HF.r.pill,
          background: HF.paper, color: HF.ink, border: 'none', cursor: 'pointer',
          boxShadow: HF.shadow.sm,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
          <span style={{ fontSize: 16 }}>☰</span>
          <span style={{
            fontFamily: HF.body, fontSize: 13, fontWeight: 700, color: HF.ink,
          }}>{idx + 1} / {total}</span>
          <span style={{
            fontFamily: HF.body, fontSize: 11, color: HF.ink3, fontWeight: 500,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120,
          }}>· all screens</span>
        </button>
        <button onClick={() => setIdx(i => Math.min(total - 1, i + 1))} disabled={idx === total - 1} style={{
          width: 48, height: 48, borderRadius: HF.r.pill, border: 'none',
          background: HF.accent, color: HF.paper, cursor: 'pointer',
          display: 'grid', placeItems: 'center', fontSize: 22, fontWeight: 700,
          opacity: idx === total - 1 ? 0.4 : 1, flex: '0 0 48px',
          boxShadow: '0 4px 12px rgba(201, 73, 42, 0.35)',
        }}>›</button>
      </div>

      {/* Stage */}
      <div onClick={onStageClick} style={{
        flex: 1, overflow: 'visible',
        paddingBottom: 152, // reserve room for tenant nav + demo nav bar
      }}>
        {Comp ? (
          <Comp />
        ) : (
          <P size={13} color={HF.err} style={{ padding: 24 }}>
            Component not loaded: {screen.comp}
          </P>
        )}
      </div>

      {/* Menu drawer */}
      {menuOpen && (
        <div data-uh-menu="true" onClick={() => setMenuOpen(false)} style={{
          position: 'fixed', inset: 0, background: 'rgba(31,26,18,0.4)',
          backdropFilter: 'blur(2px)', zIndex: 100,
          display: 'flex', alignItems: 'flex-end',
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: HF.paper, width: '100%',
            borderRadius: `${HF.r.xl}px ${HF.r.xl}px 0 0`,
            maxHeight: '88vh', overflow: 'auto',
            paddingBottom: 'env(safe-area-inset-bottom, 16px)',
          }}>
            <div style={{
              padding: '14px 18px', borderBottom: `1px solid ${HF.border}`,
              position: 'sticky', top: 0, background: HF.paper, zIndex: 1,
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <div style={{
                width: 28, height: 28, borderRadius: HF.r.sm,
                background: HF.accent, color: HF.paper,
                display: 'grid', placeItems: 'center',
                fontFamily: HF.display, fontWeight: 800, fontSize: 13,
              }}>U</div>
              <H3 style={{ fontSize: 15, flex: 1 }}>All screens · {total}</H3>
              <button onClick={() => setMenuOpen(false)} style={{
                width: 32, height: 32, borderRadius: HF.r.pill, border: 'none',
                background: HF.cream, cursor: 'pointer', fontSize: 18, color: HF.ink,
                display: 'grid', placeItems: 'center',
              }}>×</button>
            </div>
            {[...new Set(TL.map(s => s.act))].map(actName => (
              <div key={actName} style={{ padding: '8px 14px' }}>
                <div style={{
                  padding: '6px 6px',
                  fontFamily: HF.body, fontSize: 10, fontWeight: 700, color: HF.ink3,
                  textTransform: 'uppercase', letterSpacing: '0.08em',
                }}>{actName}</div>
                {TL.filter(s => s.act === actName).map(s => {
                  const sIdx = TL.indexOf(s);
                  const isActive = sIdx === idx;
                  return (
                    <button
                      key={s.id}
                      onClick={() => { setIdx(sIdx); setMenuOpen(false); }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        width: '100%', textAlign: 'left',
                        padding: '10px 8px', borderRadius: HF.r.sm,
                        background: isActive ? HF.accentLo : 'transparent',
                        border: 'none', cursor: 'pointer',
                        marginTop: 2, color: HF.ink,
                      }}>
                      <span style={{
                        width: 24, height: 24, borderRadius: HF.r.pill, flex: '0 0 24px',
                        background: isActive ? HF.accent : HF.cream,
                        color: isActive ? HF.paper : HF.ink3,
                        display: 'grid', placeItems: 'center',
                        fontFamily: HF.body, fontWeight: 700, fontSize: 10,
                      }}>{sIdx + 1}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontFamily: HF.body, fontSize: 13, fontWeight: isActive ? 700 : 500,
                          color: isActive ? HF.accent : HF.ink,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>{s.label}</div>
                        <div style={{
                          fontSize: 10, color: HF.ink3, marginTop: 1,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>{s.sub}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

window.PhoneDemo = PhoneDemo;

// One-time hint that tells the user to tap any button to advance.
function FirstTapHint() {
  const [show, setShow] = React.useState(() => !localStorage.getItem('uh-tap-hint-seen'));
  React.useEffect(() => {
    if (!show) return;
    const t = setTimeout(() => {
      setShow(false);
      localStorage.setItem('uh-tap-hint-seen', '1');
    }, 5500);
    return () => clearTimeout(t);
  }, [show]);
  if (!show) return null;
  return (
    <div style={{
      position: 'fixed', left: 16, right: 16, bottom: 92, zIndex: 70,
      padding: '12px 16px', borderRadius: HF.r.lg,
      background: HF.ink, color: HF.paper, boxShadow: HF.shadow.lg,
      display: 'flex', alignItems: 'center', gap: 10,
      animation: 'uh-hint-in .35s ease',
    }}>
      <span style={{ fontSize: 18 }}>👆</span>
      <div style={{ flex: 1 }}>
        <P size={12} weight={700} color={HF.paper}>Tap any button to continue</P>
        <P size={11} color="rgba(255,255,255,0.7)" style={{ marginTop: 2 }}>
          Or use the arrows below · swipe ← →
        </P>
      </div>
      <button onClick={() => { setShow(false); localStorage.setItem('uh-tap-hint-seen', '1'); }} style={{
        width: 26, height: 26, borderRadius: HF.r.pill, border: 'none', cursor: 'pointer',
        background: 'rgba(255,255,255,0.18)', color: HF.paper, fontSize: 13,
        display: 'grid', placeItems: 'center',
      }}>×</button>
      <style>{`@keyframes uh-hint-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }`}</style>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<PhoneDemo />);
