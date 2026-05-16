// Universal Housing · Demo Hi-Fi shell
// Single-file interactive walk-through of the v2 app. Linear timeline of
// every screen, prev/next nav, jump-to-section sidebar, keyboard shortcuts,
// shareable URL state, and a mode toggle for mobile-frame vs raw screen.

const DEMO_TIMELINE = [
  // ── ACT 1 — Discovery & application ──────────────────────────────
  { act: 'Discovery',     id: 'intro',           label: 'Meet Marisol',                 sub: 'The persona',            comp: 'PersonaIntro',  desktop: true,  desktopH: 720 },
  { act: 'Discovery',     id: 'browse-mobile',   label: 'Mobile · Browse 16 communities', sub: 'Open the app',          comp: 'V2BrowseMobile' },
  { act: 'Discovery',     id: 'browse-desktop',  label: 'Desktop · Browse',             sub: 'Comparison view',        comp: 'V2Browse',     desktop: true, desktopH: 1100 },
  { act: 'Discovery',     id: 'detail',          label: 'Property detail · Juan Garcia',sub: 'Zoom into one home',     comp: 'V2PropertyDetail' },
  { act: 'Discovery',     id: 'referral',        label: 'Agency referral landing',      sub: 'SNHSP deep-link · priority placement', comp: 'V2ReferralLanding' },

  { act: 'Apply',         id: 'apply-1',         label: 'Apply 1 · Review',             sub: 'Boarding-pass confirmation',  comp: 'V2Review' },
  { act: 'Apply',         id: 'apply-2',         label: 'Apply 2 · Household',          sub: 'Fee calculator',         comp: 'V2Household' },
  { act: 'Apply',         id: 'apply-3',         label: 'Apply 3 · Payment',            sub: 'Heartland / Loft',       comp: 'V2Payment' },
  { act: 'Apply',         id: 'apply-4',         label: 'Apply 4 · Details',            sub: 'Locks position',         comp: 'V2Details' },
  { act: 'Apply',         id: 'apply-5',         label: 'Apply 5 · Confirmation',       sub: 'On the waitlist #12',    comp: 'V2Confirm' },

  // ── ACT 2 — Active applicant phase ────────────────────────────────
  { act: 'Waiting',       id: 'wl-dash',         label: 'Day 31 · Waitlist dashboard',  sub: 'Climbing the list',      comp: 'V2WaitlistDashboard' },
  { act: 'Waiting',       id: 'proc-dash',       label: 'Day 67 · Processing dashboard',sub: 'PM is reviewing',        comp: 'V2ProcessingDashboard' },
  { act: 'Waiting',       id: 'docs',            label: 'Documents · 5 verified',       sub: 'OCR + PM review',        comp: 'V2DocumentsFeed' },
  { act: 'Waiting',       id: 'inbox',           label: 'Inbox · Frank\'s message',     sub: 'You\'re next',           comp: 'V2Inbox' },
  { act: 'Waiting',       id: 'rent-faq',        label: 'How is my rent calculated?',   sub: 'Plain-language trust',   comp: 'V2RentFAQ' },
  { act: 'Waiting',       id: 'calc-tape',       label: 'PM calc-tape review',          sub: 'Side-by-side docs',      comp: 'V2CalcTapeReview', desktop: true, desktopH: 1100 },

  // ── ACT 3 — Move-in transition ────────────────────────────────────
  { act: 'Move-in',       id: 'lease',           label: 'Day 74 · Sign the lease',      sub: 'DocuSign · 8 addenda',   comp: 'V2LeaseSign' },
  { act: 'Move-in',       id: 'walkthrough',     label: 'Day 75 · PM walkthrough',      sub: 'Scheduled with Frank',   comp: 'V2Walkthrough' },
  { act: 'Move-in',       id: 'utilities',       label: 'Day 80 · Activate utilities',  sub: 'Gas + electric',         comp: 'V2Utilities' },
  { act: 'Move-in',       id: 'keys',            label: 'Day 89 · Keys & celebration',  sub: 'You\'re home!',          comp: 'V2Keys' },

  // ── ACT 4 — Tenant lifecycle ──────────────────────────────────────
  { act: 'Tenant life',   id: 'tenant-home',     label: 'Day 90 · Tenant home',         sub: 'New daily surface',      comp: 'V2TenantHome' },
  { act: 'Tenant life',   id: 'pay-rent',        label: 'Pay rent · monthly',           sub: 'Debit / ACH only',       comp: 'V2PayRent' },
  { act: 'Tenant life',   id: 'late-grace',      label: 'Late · grace period',          sub: 'Day 3 of 5',             comp: 'V2LateGrace' },
  { act: 'Tenant life',   id: 'late-paq',        label: '7-Day Pay-or-Quit',            sub: 'NRS 40.253',             comp: 'V2LatePayOrQuit' },
  { act: 'Tenant life',   id: 'maintenance',     label: 'Maintenance · work order',     sub: 'Sink drip #WO-26-1187',  comp: 'V2Maintenance' },
  { act: 'Tenant life',   id: 'recert',          label: 'Annual recert + renewal',      sub: 'Rules-driven',           comp: 'V2Recert' },

  // ── ACT 5 — Move-out ─────────────────────────────────────────────
  { act: 'Move-out',      id: 'mo-intent',       label: '30-day move-out notice',       sub: 'NRS 118A',               comp: 'V2MoveOutIntent' },
  { act: 'Move-out',      id: 'mo-checklist',    label: 'Move-out checklist',           sub: '24 days left',           comp: 'V2MoveOutChecklist' },
  { act: 'Move-out',      id: 'mo-deposit',      label: 'Deposit · 21-day disposition', sub: 'Full $400 refund',       comp: 'V2MoveOutDeposit' },

  // ── ACT 6 — Behind the scenes ────────────────────────────────────
  { act: 'Asset Manager', id: 'am-portfolio',    label: 'AM · Portfolio dashboard',     sub: '16 communities live',    comp: 'V2AMPortfolio',     desktop: true, desktopH: 1100 },
  { act: 'Asset Manager', id: 'am-audit',        label: 'AM · Audit packs',             sub: 'One-click compile',      comp: 'V2AMAudit',         desktop: true, desktopH: 1500 },
  { act: 'Asset Manager', id: 'am-hud',          label: 'AM · HUD auto-updates',        sub: '340 amendments queued',  comp: 'V2AMHud',           desktop: true, desktopH: 1600 },
  { act: 'PM tools',      id: 'eviction',        label: 'PM · Eviction Forms Library',  sub: 'NV-court templates',     comp: 'V2EvictionForms',   desktop: true, desktopH: 1500 },

  // ── ACT 7 — Cross-cutting polish ─────────────────────────────────
  { act: 'Polish',        id: 'pol-es',          label: 'Tenant home · Spanish',        sub: 'EN/ES toggle',           comp: 'V2TenantHomeES' },
  { act: 'Polish',        id: 'pol-a11y',        label: 'Accessibility · voice',        sub: 'Section 508',            comp: 'V2Accessibility' },
  { act: 'Polish',        id: 'pol-chat',        label: 'AI chat assistant',            sub: 'Knows your account',     comp: 'V2ChatAssistant' },
  { act: 'Polish',        id: 'pol-tour',        label: 'First-time tour',              sub: 'Day-90 onboarding',      comp: 'V2OnboardingTour' },

  // ── ACT 8 — Audit-grade artifacts ────────────────────────────────
  { act: 'Documents',     id: 'pr-lease',        label: 'Lease PDF',                    sub: 'Auto-populated',         comp: 'V2LeasePDF',        desktop: true, desktopH: 1100 },
  { act: 'Documents',     id: 'pr-receipt',      label: 'Fee receipt',                  sub: '$71.90 · Heartland',     comp: 'V2FeeReceipt',      desktop: true, desktopH: 1100 },
  { act: 'Documents',     id: 'pr-calc',         label: 'Calc-tape audit trail',        sub: 'HUD-50059',              comp: 'V2CalcAuditTrail',  desktop: true, desktopH: 1100 },
  { act: 'Documents',     id: 'pr-deposit',      label: 'Deposit statement',            sub: 'NRS 118A.242',           comp: 'V2DepositStatement',desktop: true, desktopH: 1100 },

  // ── ACT 9 — Edge cases ────────────────────────────────────────────
  { act: 'Edge cases',    id: 'e-empty',         label: 'Empty saved list',             sub: 'First visit',            comp: 'V2EmptyShortlist' },
  { act: 'Edge cases',    id: 'e-full',          label: 'All 16 communities full',      sub: 'Portfolio-wide notice',  comp: 'V2AllFull' },
  { act: 'Edge cases',    id: 'e-denied',        label: 'Application denied',           sub: 'Income above cap',       comp: 'V2AppDenied' },
  { act: 'Edge cases',    id: 'e-declined',      label: 'Payment declined',             sub: 'Retry with ACH',         comp: 'V2PaymentDeclined' },
  { act: 'Edge cases',    id: 'e-empty-tabs',    label: 'No-data states',               sub: 'Calm empty tiles',       comp: 'V2NoData' },
  { act: 'Edge cases',    id: 'e-offline',       label: 'Offline state',                sub: 'Cached + graceful',      comp: 'V2Offline' },

  // ── ACT 10 — Account hub ─────────────────────────────────────────
  { act: 'Account',       id: 'acct-feed',       label: 'Notifications feed',           sub: '2 unread',               comp: 'V2NotificationFeed' },
  { act: 'Account',       id: 'acct-prefs',      label: 'Notification preferences',     sub: 'Category × channel',     comp: 'V2NotificationPrefs' },
  { act: 'Account',       id: 'acct-profile',    label: 'Account · profile',            sub: 'Household + payment',    comp: 'V2Account' },
];

// Persona intro card (act 1, screen 1)
function PersonaIntro() {
  return (
    <div style={{
      width: 1100, maxWidth: '100%', margin: '0 auto',
      display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 40, alignItems: 'center',
      padding: 32, background: HF.paper, borderRadius: HF.r.xl,
      boxShadow: HF.shadow.md, border: `1px solid ${HF.border}`,
    }}>
      <div>
        <Tag tone="accent" style={{ marginBottom: 14 }}>★ The persona</Tag>
        <H1 style={{ fontSize: 44, lineHeight: 1.05 }}>
          Meet <span style={{ color: HF.accent }}>Marisol Cabrera</span>
        </H1>
        <P size={16} color={HF.ink2} style={{ marginTop: 14, lineHeight: 1.5 }}>
          58 · retired teacher · single mom · East Las Vegas.
          Pays $1,150/mo today — over <b>40%</b> of her income.
          A neighbor told her about GPMGLV. She opens the app on a Tuesday morning.
        </P>
        <div style={{ height: 18 }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
          {[
            { l: 'Household',     v: '2 people · 1 minor' },
            { l: 'Annual income', v: '$42,800' },
            { l: 'Needs',         v: '2BR · Family' },
            { l: 'Status',        v: 'Non-veteran · 58yo' },
          ].map((t, i) => (
            <div key={i} style={{
              padding: 12, borderRadius: HF.r.md, background: HF.cream, border: `1px solid ${HF.border}`,
            }}>
              <Eyebrow color={HF.ink3}>{t.l}</Eyebrow>
              <P size={14} weight={700} style={{ marginTop: 2 }}>{t.v}</P>
            </div>
          ))}
        </div>
        <div style={{ height: 18 }} />
        <P size={13} color={HF.ink3}>
          What follows: <b>90 days</b> of her life with Universal Housing — discovery, application,
          waitlist, move-in, daily tenancy. Plus the back-office tools that make it work.
        </P>
      </div>
      <div style={{
        aspectRatio: '4 / 5', borderRadius: HF.r.lg, overflow: 'hidden',
        background: `linear-gradient(135deg, #c4b496 0%, #a8987a 100%)`,
        boxShadow: HF.shadow.lg, position: 'relative',
      }}>
        <div style={{
          position: 'absolute', inset: 0,
          background: 'url(https://images.unsplash.com/photo-1573496267526-08a69e46a409?w=800&q=80) center/cover',
          filter: 'saturate(0.9)',
        }} />
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          background: 'linear-gradient(0deg, rgba(31,26,18,0.85), transparent)',
          padding: '60px 24px 22px',
        }}>
          <Tag tone="neutral" style={{ background: 'rgba(255,255,255,0.95)', color: HF.ink }}>
            "I just want a home where I can afford to live."
          </Tag>
          <H3 style={{ color: HF.paper, marginTop: 12, fontSize: 20 }}>Marisol R. Cabrera</H3>
          <P size={12} color="rgba(255,255,255,0.85)">East Las Vegas · 2026</P>
        </div>
      </div>
    </div>
  );
}

window.PersonaIntro = PersonaIntro;

// Shell — sidebar + stage + controls
function DemoShell() {
  // Explicitly leave phone-native mode (the phone-demo HTML sets this flag
  // before this file loads via demo-shell→phone-shell chain).
  if (typeof window !== 'undefined') window.__UH_PHONE_NATIVE__ = false;
  const [idx, setIdx] = React.useState(() => {
    const hash = window.location.hash.replace('#', '');
    const found = DEMO_TIMELINE.findIndex(s => s.id === hash);
    return found >= 0 ? found : 0;
  });
  const [sidebarOpen, setSidebarOpen] = React.useState(true);
  const screen = DEMO_TIMELINE[idx];
  const total = DEMO_TIMELINE.length;

  // Keep URL hash in sync
  React.useEffect(() => {
    window.location.hash = screen.id;
  }, [screen.id]);

  // Keyboard nav
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

  const Comp = window[screen.comp];
  const acts = [...new Set(DEMO_TIMELINE.map(s => s.act))];

  return (
    <div style={{
      minHeight: '100vh', background: '#F4EFE5',
      display: 'grid',
      gridTemplateColumns: sidebarOpen ? '320px 1fr' : '60px 1fr',
      transition: 'grid-template-columns .25s',
    }}>
      {/* ── Sidebar ───────────────────────────────────────────────── */}
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
            <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
              <div style={{
                fontFamily: HF.display, fontSize: 14, fontWeight: 700,
                color: HF.ink, letterSpacing: '-0.01em', whiteSpace: 'nowrap',
              }}>Universal Housing</div>
              <div style={{
                fontFamily: HF.body, fontSize: 11, color: HF.ink3, whiteSpace: 'nowrap',
              }}>Hi-fi demo · v2</div>
            </div>
          )}
          <button onClick={() => setSidebarOpen(o => !o)} style={{
            width: 28, height: 28, borderRadius: HF.r.sm, border: 'none',
            background: HF.cream, color: HF.ink2, cursor: 'pointer',
            display: 'grid', placeItems: 'center', fontSize: 14, fontWeight: 700,
            flex: '0 0 28px',
          }}>{sidebarOpen ? '‹' : '›'}</button>
        </div>

        {sidebarOpen ? (
          <div style={{ flex: 1, overflow: 'auto', padding: '8px 8px 24px' }}>
            {acts.map(actName => (
              <div key={actName} style={{ marginTop: 12 }}>
                <div style={{
                  padding: '4px 12px',
                  fontFamily: HF.body, fontSize: 10, fontWeight: 700, color: HF.ink3,
                  textTransform: 'uppercase', letterSpacing: '0.08em',
                }}>{actName}</div>
                {DEMO_TIMELINE.filter(s => s.act === actName).map((s, i) => {
                  const sIdx = DEMO_TIMELINE.indexOf(s);
                  const isActive = sIdx === idx;
                  return (
                    <button
                      key={s.id}
                      onClick={() => setIdx(sIdx)}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        padding: '8px 12px', borderRadius: HF.r.sm,
                        background: isActive ? HF.accentLo : 'transparent',
                        border: 'none', cursor: 'pointer',
                        marginTop: 2, color: HF.ink,
                      }}>
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 8,
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
                          }}>{s.label}</div>
                          <div style={{ fontSize: 10, color: HF.ink3, marginTop: 1 }}>{s.sub}</div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
            {acts.map((actName, i) => (
              <div key={actName} style={{
                writingMode: 'vertical-rl', transform: 'rotate(180deg)',
                padding: '8px 0', fontFamily: HF.body, fontSize: 10, fontWeight: 700,
                color: HF.ink3, textAlign: 'center', letterSpacing: '0.05em',
                textTransform: 'uppercase',
              }}>{actName}</div>
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

      {/* ── Main stage ────────────────────────────────────────────── */}
      <main style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Top bar */}
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
            <Button variant="secondary" size="sm" onClick={() => setIdx(Math.max(0, idx - 1))}>
              ← Prev
            </Button>
            <Button variant="primary" size="sm" onClick={() => setIdx(Math.min(total - 1, idx + 1))}>
              Next →
            </Button>
          </div>
        </div>

        {/* Stage */}
        <div style={{
          flex: 1, padding: '28px 32px', overflow: 'auto',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        }}>
          {screen.comp === 'PersonaIntro' ? (
            <Comp />
          ) : screen.desktop ? (
            <div style={{
              width: '100%', maxWidth: 1440, minHeight: screen.desktopH || 1100,
              background: HF.paper, borderRadius: HF.r.lg, overflow: 'hidden',
              boxShadow: HF.shadow.md, border: `1px solid ${HF.border}`,
            }}>
              <Comp />
            </div>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 40px' }}>
              <Comp />
            </div>
          )}
        </div>

        {/* Bottom progress strip */}
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

window.DemoShell = DemoShell;
window.DEMO_TIMELINE = DEMO_TIMELINE;

// Only mount DemoShell if no phone demo is taking over. The phone shell sets
// __UH_PHONE_SHELL_WILL_RENDER__ before this file loads.
if (!window.__UH_PHONE_SHELL_WILL_RENDER__) {
  ReactDOM.createRoot(document.getElementById('root')).render(<DemoShell />);
}
