// V2 · Tenant lifecycle — daily-use screens for the active tenant.
// Mobile-first per the brief. Real Juan Garcia data, real NV compliance
// numbers (7-day Pay-or-Quit NRS 40.253, late fee $50 + $10/day, 21-day
// deposit, recert 120/90/60).

// Bottom tab nav — shared across tenant lifecycle.
// In phone-native demo mode it pins to the actual viewport (above the
// demo nav bar), so the tenant's tab bar feels like a real native nav.
function TenantNav({ active = 'home' }) {
  const items = [
    { id: 'home',  l: 'Home',     icon: 'home',    target: 'tenant-home' },
    { id: 'pay',   l: 'Pay',      icon: 'spark',   target: 'pay-rent' },
    { id: 'maint', l: 'Repairs',  icon: 'warning', target: 'maintenance' },
    { id: 'docs',  l: 'Docs',     icon: 'map',     target: 'docs' },
    { id: 'msg',   l: 'Inbox',    icon: 'bell',    target: 'inbox' },
  ];
  const isPhone = typeof window !== 'undefined' && window.__UH_PHONE_NATIVE__;
  function go(target) {
    if (typeof window !== 'undefined' && typeof window.__UH_GO_TO__ === 'function') {
      window.__UH_GO_TO__(target);
    }
  }
  return (
    <div data-uh-nav="true" style={{
      position: isPhone ? 'fixed' : 'absolute',
      left: 0, right: 0,
      bottom: isPhone ? 'calc(72px + env(safe-area-inset-bottom, 0px))' : 0,
      zIndex: isPhone ? 55 : 'auto',
      background: HF.paper, borderTop: `1px solid ${HF.border}`,
      padding: '8px 10px 12px', display: 'flex', justifyContent: 'space-around',
      boxShadow: isPhone ? '0 -4px 16px rgba(31,26,18,0.06)' : 'none',
    }}>
      {items.map(item => {
        const isActive = item.id === active;
        return (
          <button key={item.id} onClick={() => go(item.target)} style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, flex: 1,
            background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px 0',
          }}>
            <Icon name={item.icon} size={18} color={isActive ? HF.accent : HF.ink3} />
            <span style={{
              fontFamily: HF.body, fontSize: 10,
              fontWeight: isActive ? 700 : 500,
              color: isActive ? HF.accent : HF.ink3,
            }}>{item.l}</span>
          </button>
        );
      })}
    </div>
  );
}

// PropertyAnchor — small pinned card. Lives at top of tenant screens.
function PropertyAnchor({ short }) {
  const p = propBySlug('juan-garcia');
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 12px', borderRadius: HF.r.md,
      background: HF.paper, border: `1px solid ${HF.border}`,
    }}>
      <div style={{
        width: 40, height: 40, flex: '0 0 40px', borderRadius: HF.r.sm,
        background: `#c4b496 url(${p.photo}) center/cover`,
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <P size={12} weight={700} style={{
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{short ? 'Juan Garcia · Unit 214' : p.name}</P>
        <P size={10} color={HF.ink3}>2BR · Unit 214 · {p.neighborhood}</P>
      </div>
      <Tag tone="ok">Active</Tag>
    </div>
  );
}

// ── 4.1 Tenant home dashboard ────────────────────────────────────────
function V2TenantHome() {
  return (
    <MobileFrame label="Day 90 · Tenant home" h={2100}>
      <div style={{ padding: '8px 20px 14px', background: HF.paper, borderBottom: `1px solid ${HF.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: HF.r.sm, background: HF.accent, color: HF.paper,
            display: 'grid', placeItems: 'center', fontFamily: HF.display, fontWeight: 800, fontSize: 15,
          }}>U</div>
          <div style={{ flex: 1 }}>
            <P size={11} color={HF.ink3}>Welcome home,</P>
            <H3 style={{ fontSize: 16 }}>Marisol</H3>
          </div>
          <div style={{
            width: 36, height: 36, borderRadius: HF.r.pill, background: HF.cream, border: `1px solid ${HF.border}`,
            display: 'grid', placeItems: 'center',
          }}>
            <Icon name="bell" size={16} color={HF.ink} />
          </div>
        </div>
      </div>

      <div style={{ padding: '14px 20px 100px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <PropertyAnchor />

        {/* Balance card · primary */}
        <Surface raised style={{ background: HF.ok, border: 'none', color: HF.paper }}>
          <div style={{ padding: '18px 20px' }}>
            <Eyebrow color="rgba(255,255,255,0.85)">Current balance</Eyebrow>
            <div style={{ marginTop: 6, display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ fontFamily: HF.display, fontWeight: 800, fontSize: 38, color: HF.paper, letterSpacing: '-0.02em' }}>
                $964.00
              </span>
            </div>
            <P size={11} color="rgba(255,255,255,0.85)" style={{ marginTop: 4 }}>
              Due Aug 1 · 17 days away · auto-pay off
            </P>
            <div style={{ height: 12 }} />
            <span data-uh-routed="true" onClick={() => window.__UH_GO_TO__ && window.__UH_GO_TO__('pay-rent')}>
              <Button variant="secondary" size="md" style={{ background: HF.paper, color: HF.ok, border: 'none' }}>
                Pay rent
                <Icon name="arrow" size={14} color={HF.ok} style={{ marginLeft: 4 }} />
              </Button>
            </span>
          </div>
        </Surface>

        {/* Auto-pay nudge */}
        <Surface style={{ background: HF.accentLo, borderColor: '#F3D7CB' }}>
          <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <span style={{ fontSize: 24 }}>💸</span>
            <div style={{ flex: 1 }}>
              <H3 style={{ fontSize: 14, color: HF.accent }}>Enroll in auto-pay · save $10/mo</H3>
              <P size={11} color={HF.ink2} style={{ marginTop: 2, lineHeight: 1.4 }}>
                Never miss a payment. $10 off every month while active. Recovers your application fee in ~7 months.
              </P>
              <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
                <span data-uh-routed="true" onClick={() => window.__UH_GO_TO__ && window.__UH_GO_TO__('acct-profile')}>
                  <Button variant="primary" size="sm">Enroll now</Button>
                </span>
                <Button variant="ghost" size="sm">Maybe later</Button>
              </div>
            </div>
          </div>
        </Surface>

        {/* Upcoming bills countdown */}
        <Surface>
          <div style={{ padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <Eyebrow color={HF.ink3}>Upcoming bills</Eyebrow>
              <button data-uh-routed="true"
                      onClick={() => window.__UH_GO_TO__ && window.__UH_GO_TO__('pay-rent')}
                      style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                fontFamily: HF.body, fontSize: 11, fontWeight: 700, color: HF.accent,
              }}>See all →</button>
            </div>
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[
                { icon: '$', l: 'Rent', sub: 'GPMG · Aug 1', amt: '$964.00', days: 17, primary: true, target: 'pay-rent' },
                { icon: '🔥', l: 'Gas', sub: 'Southwest Gas · Aug 8', amt: '$31.40', days: 24, target: 'pay-rent' },
                { icon: '⚡', l: 'Electric', sub: 'NV Energy · Aug 14', amt: '$96.20', days: 30, target: 'pay-rent' },
              ].map((b, i) => (
                <span key={i} data-uh-routed="true"
                      onClick={() => window.__UH_GO_TO__ && window.__UH_GO_TO__(b.target)}
                      style={{ display: 'block' }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 10px', borderRadius: HF.r.sm,
                    background: b.primary ? HF.accentLo : HF.cream,
                    border: `1px solid ${b.primary ? '#F3D7CB' : HF.border}`,
                    cursor: 'pointer',
                  }}>
                    <span style={{ fontSize: 14, width: 20, textAlign: 'center' }}>{b.icon}</span>
                    <div style={{ flex: 1 }}>
                      <P size={12} weight={700}>{b.l}</P>
                      <P size={10} color={HF.ink3}>{b.sub}</P>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontFamily: HF.display, fontWeight: 800, fontSize: 13, color: b.primary ? HF.accent : HF.ink }}>
                        {b.amt}
                      </span>
                      <P size={10} color={HF.ink3}>in {b.days}d</P>
                    </div>
                  </div>
                </span>
              ))}
            </div>
            <P size={10} color={HF.ink3} style={{ marginTop: 10, lineHeight: 1.4 }}>
              💡 Annual recert is rules-driven — we'll SMS · email · push you 120 days out (Apr 2027).
            </P>
          </div>
        </Surface>

        {/* Two-up tiles */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <span data-uh-routed="true" onClick={() => window.__UH_GO_TO__ && window.__UH_GO_TO__('maintenance')}>
            <Surface>
              <div style={{ padding: '12px 14px', cursor: 'pointer' }}>
                <Eyebrow color={HF.ink3}>Work orders</Eyebrow>
                <H1 style={{ fontSize: 24, marginTop: 4 }}>0</H1>
                <P size={10} color={HF.ink3}>All clear</P>
              </div>
            </Surface>
          </span>
          <span data-uh-routed="true" onClick={() => window.__UH_GO_TO__ && window.__UH_GO_TO__('pay-rent')}>
            <Surface>
              <div style={{ padding: '12px 14px', cursor: 'pointer' }}>
                <Eyebrow color={HF.ink3}>Rent history</Eyebrow>
                <H1 style={{ fontSize: 24, marginTop: 4, color: HF.ok }}>1 / 1</H1>
                <P size={10} color={HF.ok} weight={700}>✓ On time</P>
              </div>
            </Surface>
          </span>
        </div>

        {/* Recent activity */}
        <Surface>
          <div style={{ padding: '14px 16px' }}>
            <Eyebrow color={HF.ink3}>Recent activity</Eyebrow>
            <div style={{ marginTop: 8 }}>
              {[
                { icon: '🔑', l: 'Move-in completed', d: 'Jul 15', amt: '' },
                { icon: '$', l: 'July rent (prorated)', d: 'Jul 15', amt: '−$498.00' },
                { icon: '✉', l: 'Welcome message from Frank', d: 'Jul 16', amt: '' },
              ].map((row, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 0', borderTop: i === 0 ? 'none' : `1px dotted ${HF.border}`,
                }}>
                  <span style={{ fontSize: 13, width: 18, textAlign: 'center' }}>{row.icon}</span>
                  <P size={12} style={{ flex: 1 }}>{row.l}</P>
                  {row.amt && <P size={11} weight={700} color={HF.ink2}>{row.amt}</P>}
                  <P size={10} color={HF.ink3}>{row.d}</P>
                </div>
              ))}
            </div>
          </div>
        </Surface>
      </div>

      <TenantNav active="home" />
    </MobileFrame>
  );
}

// ── 4.2 Pay rent flow ────────────────────────────────────────────────
function V2PayRent() {
  return (
    <MobileFrame label="Pay rent · review + submit" h={1700}>
      <div style={{ padding: '10px 20px 14px', background: HF.paper, borderBottom: `1px solid ${HF.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button style={{
            width: 36, height: 36, borderRadius: HF.r.pill, background: HF.cream,
            border: `1px solid ${HF.border}`, cursor: 'pointer',
            display: 'grid', placeItems: 'center',
          }}><Icon name="arrowLeft" size={16} color={HF.ink} /></button>
          <H3 style={{ fontSize: 16, flex: 1 }}>Pay rent</H3>
        </div>
      </div>

      <div style={{ padding: '20px 20px 100px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Big amount */}
        <Surface raised>
          <div style={{ padding: '20px 22px', textAlign: 'center' }}>
            <Eyebrow color={HF.ink3}>August rent due</Eyebrow>
            <H1 style={{ fontSize: 42, marginTop: 6, letterSpacing: '-0.03em' }}>$964.00</H1>
            <P size={12} color={HF.ink3} style={{ marginTop: 4 }}>
              Juan Garcia · Unit 214 · due Aug 1, 2026
            </P>
          </div>
        </Surface>

        {/* Breakdown */}
        <Surface>
          <div style={{ padding: '14px 16px' }}>
            <Eyebrow color={HF.ink3}>How we got there</Eyebrow>
            <div style={{ marginTop: 10 }}>
              {[
                ['Section 42 LIHTC cap', '$964.00'],
                ['Utility allowance (deducted)', '−$0.00'],
                ['Late fees', '$0.00'],
              ].map((row, i) => (
                <div key={i} style={{
                  display: 'flex', justifyContent: 'space-between', padding: '4px 0',
                  borderBottom: i === 2 ? 'none' : `1px dotted ${HF.border}`,
                }}>
                  <P size={12} color={HF.ink2}>{row[0]}</P>
                  <P size={12} weight={600}>{row[1]}</P>
                </div>
              ))}
            </div>
            <button data-uh-routed="true"
              onClick={() => window.__UH_GO_TO__ && window.__UH_GO_TO__('rent-faq')}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                fontFamily: HF.body, fontSize: 11, fontWeight: 700, color: HF.accent,
                marginTop: 8, textDecoration: 'underline',
            }}>How is my rent calculated? →</button>
          </div>
        </Surface>

        {/* Payment method */}
        <Surface>
          <div style={{ padding: '14px 16px' }}>
            <Eyebrow color={HF.ink3}>Payment method · credit/debit only</Eyebrow>
            <div style={{
              marginTop: 10, padding: '10px 12px', borderRadius: HF.r.sm,
              border: `1.5px solid ${HF.accent}`, background: HF.accentLo,
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <div style={{
                width: 36, height: 24, borderRadius: 4, background: HF.ink, color: HF.paper,
                display: 'grid', placeItems: 'center', fontFamily: HF.display, fontWeight: 800, fontSize: 9,
              }}>VISA</div>
              <P size={12} weight={700} style={{ flex: 1, fontFamily: HF.mono }}>•••• 4242</P>
              <Tag tone="accent">Default</Tag>
            </div>
            <button style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              fontFamily: HF.body, fontSize: 11, fontWeight: 600, color: HF.ink3,
              marginTop: 6, textDecoration: 'underline',
            }}>+ Add another card</button>
          </div>
        </Surface>

        {/* Auto-pay nudge */}
        <Surface style={{ background: HF.sageLo, borderColor: '#D2DDC9' }}>
          <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 22 }}>💸</span>
            <div style={{ flex: 1 }}>
              <P size={12} weight={700} color={HF.sage}>
                Skip a step · save <b>$10/mo</b> with auto-pay
              </P>
              <P size={11} color={HF.ink2} style={{ marginTop: 2, lineHeight: 1.4 }}>
                <b>Debit card or ACH bank transfer</b> only — same accounts you already use.
                After 7 months your $71.90 fee is back.
              </P>
            </div>
            <Button variant="sage" size="sm" data-uh-routed="true"
              onClick={() => window.__UH_GO_TO__ && window.__UH_GO_TO__('acct-profile')}>Enroll</Button>
          </div>
        </Surface>

        <span data-uh-routed="true" onClick={() => window.__UH_GO_TO__ && window.__UH_GO_TO__('tenant-home')}>
          <Button variant="primary" size="lg" full>
            Pay $964.00 now
            <Icon name="arrow" size={16} color={HF.paper} style={{ marginLeft: 4 }} />
          </Button>
        </span>
        <P size={10} color={HF.ink3} style={{ textAlign: 'center' }}>
          🔒 Heartland · PCI-DSS encrypted
        </P>
      </div>

      <TenantNav active="pay" />
    </MobileFrame>
  );
}

// ── 4.3 Late rent · stage 1: grace period ────────────────────────────
function V2LateGrace() {
  return (
    <MobileFrame label="Late · day 3 grace period" h={1900}>
      <div style={{ padding: '10px 20px 14px', background: HF.paper, borderBottom: `1px solid ${HF.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button style={{
            width: 36, height: 36, borderRadius: HF.r.pill, background: HF.cream,
            border: `1px solid ${HF.border}`, cursor: 'pointer',
            display: 'grid', placeItems: 'center',
          }}><Icon name="arrowLeft" size={16} color={HF.ink} /></button>
          <H3 style={{ fontSize: 16, flex: 1 }}>Rent overdue</H3>
        </div>
      </div>

      <div style={{ padding: '20px 20px 100px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Surface raised style={{ background: HF.warnLo, borderColor: '#E8D6A8' }}>
          <div style={{ padding: '18px 20px' }}>
            <Eyebrow color={HF.warn}>Inside grace period · day 3 of 5</Eyebrow>
            <H1 style={{ fontSize: 32, marginTop: 6, color: '#6B4A11' }}>
              Pay by Aug 5 to avoid fees
            </H1>
            <P size={13} color={HF.ink2} style={{ marginTop: 8, lineHeight: 1.5 }}>
              Rent was due Aug 1. You have <b>2 days left</b> in the grace period. After day 5,
              a <b>$50 late fee</b> applies, plus <b>$10/day</b> until paid in full.
            </P>
          </div>
        </Surface>

        {/* Balance */}
        <Surface>
          <div style={{ padding: '16px 18px' }}>
            <Eyebrow color={HF.ink3}>Total owed</Eyebrow>
            <H1 style={{ fontSize: 38, marginTop: 4 }}>$964.00</H1>
            <P size={11} color={HF.ink3} style={{ marginTop: 4 }}>
              August rent · no fees yet
            </P>
            <div style={{ height: 12 }} />
            <span data-uh-routed="true" onClick={() => window.__UH_GO_TO__ && window.__UH_GO_TO__('tenant-home')}>
              <Button variant="primary" size="lg" full>
                Pay $964.00 now
                <Icon name="arrow" size={16} color={HF.paper} style={{ marginLeft: 4 }} />
              </Button>
            </span>
          </div>
        </Surface>

        {/* Offramps */}
        <Surface>
          <div style={{ padding: '14px 16px' }}>
            <Eyebrow color={HF.ink3}>Need help?</Eyebrow>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { icon: '🗓', l: 'Request a payment plan', sub: 'Split into 2–3 payments with Frank', accent: true, target: 'inbox' },
                { icon: '🤝', l: 'Rent assistance · CHA, ERAP', sub: 'Local programs · free to apply', target: 'inbox' },
                { icon: '⚖', l: 'Free NV Legal Services', sub: '(702) 386-1070', target: 'inbox' },
              ].map((row, i) => (
                <span key={i} data-uh-routed="true"
                      onClick={() => window.__UH_GO_TO__ && window.__UH_GO_TO__(row.target)}
                      style={{ display: 'block' }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 10px', borderRadius: HF.r.sm,
                    border: `1px solid ${row.accent ? HF.accent : HF.border}`,
                    background: row.accent ? HF.accentLo : HF.paper,
                    cursor: 'pointer',
                  }}>
                    <span style={{ fontSize: 16 }}>{row.icon}</span>
                    <div style={{ flex: 1 }}>
                      <P size={12} weight={700} color={row.accent ? HF.accent : HF.ink}>{row.l}</P>
                      <P size={10} color={HF.ink3}>{row.sub}</P>
                    </div>
                    <Icon name="arrow" size={14} color={row.accent ? HF.accent : HF.ink3} />
                  </div>
                </span>
              ))}
            </div>
          </div>
        </Surface>

        <Surface>
          <div style={{ padding: '12px 14px' }}>
            <Eyebrow color={HF.ink3}>Your rights</Eyebrow>
            <div style={{ marginTop: 6 }}>
              {[
                'Frank cannot change locks or shut off utilities.',
                'Paying in full before any deadline stops the process.',
                'You have the right to legal representation at any stage.',
              ].map((line, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  <span style={{ color: HF.ink3, fontSize: 11, marginTop: 2 }}>•</span>
                  <P size={11} color={HF.ink2}>{line}</P>
                </div>
              ))}
            </div>
          </div>
        </Surface>
      </div>

      <TenantNav active="pay" />
    </MobileFrame>
  );
}

// ── 4.4 Late rent · stage 2: 7-day Pay-or-Quit served (NRS 40.253) ───
function V2LatePayOrQuit() {
  return (
    <MobileFrame label="Late · 7-Day Pay-or-Quit · NRS 40.253" h={2000}>
      <div style={{ padding: '10px 20px 14px', background: HF.paper, borderBottom: `1px solid ${HF.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button style={{
            width: 36, height: 36, borderRadius: HF.r.pill, background: HF.cream,
            border: `1px solid ${HF.border}`, cursor: 'pointer',
            display: 'grid', placeItems: 'center',
          }}><Icon name="arrowLeft" size={16} color={HF.ink} /></button>
          <H3 style={{ fontSize: 16, flex: 1 }}>Official notice</H3>
          <Tag tone="err">URGENT</Tag>
        </div>
      </div>

      <div style={{ padding: '20px 20px 100px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Surface raised style={{ background: HF.errLo, borderColor: '#EDCBC4' }}>
          <div style={{ padding: '18px 20px' }}>
            <Eyebrow color={HF.err}>7-Day Pay-or-Quit · NRS 40.253</Eyebrow>
            <H1 style={{ fontSize: 30, marginTop: 6, color: '#7A2117', letterSpacing: '-0.02em' }}>
              5 days to pay
            </H1>
            <P size={13} color={HF.ink2} style={{ marginTop: 8, lineHeight: 1.5 }}>
              Frank served this notice on Aug 7. You have until <b>Aug 14 at 11:59 PM</b> to pay
              in full or vacate. Otherwise the case goes to Justice Court.
            </P>
          </div>
        </Surface>

        {/* Legal record */}
        <Surface>
          <div style={{ padding: '14px 16px' }}>
            <Eyebrow color={HF.ink3}>Record</Eyebrow>
            <div style={{ marginTop: 8 }}>
              {[
                ['Notice #', 'PAQ-26-1087'],
                ['Issued', 'Aug 7, 2026 · 9:14 AM PDT'],
                ['Served', 'Aug 7, 2026 · 4:21 PM · in person + email + posted at door'],
                ['Issued by', 'Frank Hawkins · PM'],
                ['Legal ref', 'NRS 40.253 · 7-Day Pay-or-Quit'],
                ['Jurisdiction', 'Las Vegas Justice Court'],
              ].map((row, i) => (
                <div key={i} style={{
                  display: 'grid', gridTemplateColumns: '90px 1fr', gap: 8,
                  padding: '4px 0', borderBottom: i === 5 ? 'none' : `1px dotted ${HF.border}`,
                }}>
                  <P size={10} color={HF.ink3} weight={600} style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>{row[0]}</P>
                  <P size={11} weight={500}>{row[1]}</P>
                </div>
              ))}
            </div>
          </div>
        </Surface>

        {/* Owed */}
        <Surface raised style={{ borderColor: HF.err }}>
          <div style={{ padding: '14px 16px' }}>
            <Eyebrow color={HF.err}>Total owed (paying in full stops this)</Eyebrow>
            <H1 style={{ fontSize: 36, marginTop: 4, color: HF.err }}>$1,034.00</H1>
            <div style={{ marginTop: 10 }}>
              {[
                ['August rent', '$964.00'],
                ['Late fee · day 6', '$50.00'],
                ['Daily late · 2 × $10', '$20.00'],
              ].map((row, i) => (
                <div key={i} style={{
                  display: 'flex', justifyContent: 'space-between', padding: '4px 0',
                  borderTop: i === 0 ? `1px dashed ${HF.border}` : 'none',
                }}>
                  <P size={12}>{row[0]}</P>
                  <P size={12} weight={600}>{row[1]}</P>
                </div>
              ))}
            </div>
            <div style={{ height: 10 }} />
            <span data-uh-routed="true" onClick={() => window.__UH_GO_TO__ && window.__UH_GO_TO__('tenant-home')}>
              <Button variant="primary" size="lg" full>Pay $1,034.00 now</Button>
            </span>
          </div>
        </Surface>

        {/* Timeline */}
        <Surface>
          <div style={{ padding: '14px 16px' }}>
            <Eyebrow color={HF.ink3}>NV eviction timeline</Eyebrow>
            <div style={{ marginTop: 10 }}>
              {[
                { d: 1, l: 'Rent due', done: true },
                { d: 5, l: 'Grace period ends', done: true, sub: 'Late fees begin' },
                { d: 7, l: '7-Day Pay-or-Quit served', current: true, sub: 'You are here · Aug 7' },
                { d: 14, l: 'Notice expires · Aug 14', sub: 'Pay or vacate' },
                { d: 21, l: 'Summary eviction filed', sub: 'Justice Court' },
                { d: 30, l: 'Court hearing · right to defend', sub: 'NV Legal Services free' },
              ].map((s, i, arr) => (
                <div key={i} style={{
                  display: 'flex', gap: 10, padding: '6px 0',
                  borderTop: i === 0 ? 'none' : `1px dotted ${HF.border}`,
                  opacity: s.done ? .55 : 1,
                }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: HF.r.pill, flex: '0 0 28px',
                    background: s.current ? HF.err : s.done ? HF.border : HF.paper,
                    border: `1.5px solid ${s.current ? HF.err : s.done ? HF.border : HF.ink3}`,
                    color: s.current ? HF.paper : s.done ? HF.ink2 : HF.ink2,
                    display: 'grid', placeItems: 'center',
                    fontFamily: HF.display, fontWeight: 800, fontSize: 11,
                  }}>{s.done ? '✓' : s.d}</div>
                  <div style={{ flex: 1 }}>
                    <P size={12} weight={s.current ? 700 : 600} color={s.current ? HF.err : HF.ink}>{s.l}</P>
                    {s.sub && <P size={10} color={HF.ink3}>{s.sub}</P>}
                  </div>
                  {s.current && <Tag tone="err">NOW</Tag>}
                </div>
              ))}
            </div>
          </div>
        </Surface>

        {/* Acknowledge */}
        <Surface>
          <div style={{ padding: '12px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 14 }}>📜</span>
              <Eyebrow>Acknowledge receipt</Eyebrow>
            </div>
            <P size={11} color={HF.ink2} style={{ marginTop: 4, lineHeight: 1.4 }}>
              Confirming doesn't mean you accept. It records that you saw the notice and
              protects your defense in court.
            </P>
            <div style={{ marginTop: 8 }}>
              <Button variant="secondary" size="md" full>Sign acknowledgement</Button>
            </div>
            <P size={9} color={HF.ink3} style={{ textAlign: 'center', marginTop: 4 }}>
              Timestamp + IP captured · NRS 40.253 record
            </P>
          </div>
        </Surface>
      </div>

      <TenantNav active="msg" />
    </MobileFrame>
  );
}

// ── 4.5 Maintenance request submit ───────────────────────────────────
function V2Maintenance() {
  return (
    <MobileFrame label="New repair · scheduled" h={1900}>
      <div style={{ padding: '10px 20px 14px', background: HF.paper, borderBottom: `1px solid ${HF.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button style={{
            width: 36, height: 36, borderRadius: HF.r.pill, background: HF.cream,
            border: `1px solid ${HF.border}`, cursor: 'pointer',
            display: 'grid', placeItems: 'center',
          }}><Icon name="arrowLeft" size={16} color={HF.ink} /></button>
          <H3 style={{ fontSize: 16, flex: 1 }}>Work order submitted</H3>
        </div>
      </div>

      <div style={{ padding: '20px 20px 100px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ textAlign: 'center', padding: '8px 0' }}>
          <div style={{
            width: 72, height: 72, borderRadius: HF.r.pill, margin: '0 auto',
            background: HF.okLo, border: `3px solid ${HF.ok}`,
            display: 'grid', placeItems: 'center',
          }}>
            <Icon name="check" size={32} color={HF.ok} />
          </div>
        </div>
        <H1 style={{ fontSize: 28, textAlign: 'center' }}>You're booked!</H1>
        <P size={13} color={HF.ink3} style={{ textAlign: 'center' }}>
          Frank confirms within 24h. You'll get SMS + email + push reminders.
        </P>

        <Surface raised style={{ borderColor: HF.ok }}>
          <div style={{ padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Eyebrow color={HF.ok}>Work order</Eyebrow>
              <span style={{ marginLeft: 'auto', fontFamily: HF.mono, fontSize: 10, color: HF.ink3 }}>
                #WO-26-1187
              </span>
            </div>
            <H3 style={{ fontSize: 15, marginTop: 6 }}>🚰 Kitchen sink drip</H3>
            <P size={11} color={HF.ink3}>3 photos · voice note · standard priority</P>

            <div style={{
              marginTop: 12, paddingTop: 12, borderTop: `1px dashed ${HF.border}`,
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12,
            }}>
              <div>
                <Eyebrow color={HF.ink3}>Scheduled</Eyebrow>
                <P size={13} weight={700} style={{ marginTop: 2 }}>Sep 15 · 10–12</P>
              </div>
              <div>
                <Eyebrow color={HF.ink3}>Status</Eyebrow>
                <P size={13} weight={700} color={HF.warn} style={{ marginTop: 2 }}>Awaiting PM</P>
              </div>
            </div>
          </div>
        </Surface>

        <Surface>
          <div style={{ padding: '14px 16px' }}>
            <Eyebrow color={HF.ink3}>What happens next</Eyebrow>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                'Frank confirms within 24h via SMS.',
                'We remind you 24h ahead and again 2h before.',
                'After the fix, you rate the service.',
              ].map((line, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <div style={{
                    width: 20, height: 20, borderRadius: HF.r.pill, flex: '0 0 20px',
                    background: HF.accent, color: HF.paper,
                    display: 'grid', placeItems: 'center',
                    fontFamily: HF.display, fontWeight: 800, fontSize: 11,
                  }}>{i + 1}</div>
                  <P size={12}>{line}</P>
                </div>
              ))}
            </div>
          </div>
        </Surface>

        <span data-uh-routed="true" onClick={() => window.__UH_GO_TO__ && window.__UH_GO_TO__('tenant-home')}>
          <Button variant="primary" size="lg" full>View my repairs</Button>
        </span>
      </div>

      <TenantNav active="maint" />
    </MobileFrame>
  );
}

// ── 4.6 Recert + Renewal (combined per debrief) ──────────────────────
function V2Recert() {
  return (
    <MobileFrame label="Day 280 · Recert + renewal" h={1800}>
      <div style={{ padding: '10px 20px 14px', background: HF.paper, borderBottom: `1px solid ${HF.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button style={{
            width: 36, height: 36, borderRadius: HF.r.pill, background: HF.cream,
            border: `1px solid ${HF.border}`, cursor: 'pointer',
            display: 'grid', placeItems: 'center',
          }}><Icon name="arrowLeft" size={16} color={HF.ink} /></button>
          <H3 style={{ fontSize: 16, flex: 1 }}>Annual recertification</H3>
        </div>
      </div>

      <div style={{ padding: '20px 20px 100px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <PropertyAnchor />

        <Surface raised style={{ background: HF.accent, color: HF.paper, border: 'none' }}>
          <div style={{ padding: '18px 20px' }}>
            <Eyebrow color="rgba(255,255,255,0.85)">Recert + renewal · together</Eyebrow>
            <H1 style={{ fontSize: 30, color: HF.paper, marginTop: 6 }}>Opens in 90 days</H1>
            <P size={12} color="rgba(255,255,255,0.85)" style={{ marginTop: 6, lineHeight: 1.5 }}>
              Each year, we verify your income still qualifies and renew your lease together —
              one flow. If your income qualifies, we auto-prep a 12-month renewal at your same rate.
            </P>
            <div style={{
              marginTop: 12, paddingTop: 12, borderTop: `1px dashed rgba(255,255,255,0.4)`,
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10,
            }}>
              <div>
                <Eyebrow color="rgba(255,255,255,0.85)">Due</Eyebrow>
                <P size={14} weight={700} color={HF.paper} style={{ marginTop: 2 }}>Jul 15, 2027</P>
              </div>
              <div>
                <Eyebrow color="rgba(255,255,255,0.85)">Reminder cadence</Eyebrow>
                <P size={14} weight={700} color={HF.paper} style={{ marginTop: 2 }}>120 · 90 · 60d</P>
              </div>
            </div>
          </div>
        </Surface>

        <Surface>
          <div style={{ padding: '14px 16px' }}>
            <Eyebrow color={HF.ink3}>What you'll re-upload</Eyebrow>
            <P size={11} color={HF.ink3} style={{ marginTop: 4 }}>
              Only what's changed — last year's values carry forward as "no change."
            </P>
            <div style={{ marginTop: 10 }}>
              {[
                { l: 'Last year\'s tax return (1040)', need: 'new' },
                { l: '3 most recent pay stubs', need: 'new' },
                { l: 'Bank statements (last 60 days)', need: 'new' },
                { l: 'ID + Social Security card', need: 'carryover' },
                { l: 'Employer verification letter', need: 'on-request' },
              ].map((row, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '7px 0', borderTop: i === 0 ? 'none' : `1px dotted ${HF.border}`,
                }}>
                  <div style={{
                    width: 18, height: 18, borderRadius: HF.r.pill,
                    background: row.need === 'carryover' ? HF.ok : HF.paper,
                    border: `1.5px solid ${row.need === 'carryover' ? HF.ok : row.need === 'new' ? HF.accent : HF.ink3}`,
                    display: 'grid', placeItems: 'center',
                  }}>
                    {row.need === 'carryover' && <Icon name="check" size={11} color={HF.paper} />}
                  </div>
                  <P size={12} style={{ flex: 1 }}>{row.l}</P>
                  <Tag tone={row.need === 'carryover' ? 'ok' : row.need === 'new' ? 'accent' : 'neutral'}>
                    {row.need === 'carryover' ? 'Carries over' : row.need === 'new' ? 'New' : 'If asked'}
                  </Tag>
                </div>
              ))}
            </div>
          </div>
        </Surface>

        <Surface style={{ background: HF.sageLo, borderColor: '#D2DDC9' }}>
          <div style={{ padding: '12px 14px' }}>
            <P size={11} color={HF.ink2} style={{ lineHeight: 1.5 }}>
              <b style={{ color: HF.sage }}>If your income still qualifies under 60% AMI</b> →
              we auto-prep a 12-month renewal at $964/mo. You sign on the same screen.
              If your income grew past the 140% limit, we'll walk you through your options.
            </P>
          </div>
        </Surface>

        <span data-uh-routed="true" onClick={() => window.__UH_GO_TO__ && window.__UH_GO_TO__('docs')}>
          <Button variant="primary" size="lg" full>
            Start recert + renewal early
            <Icon name="arrow" size={16} color={HF.paper} style={{ marginLeft: 4 }} />
          </Button>
        </span>
      </div>

      <TenantNav active="docs" />
    </MobileFrame>
  );
}

Object.assign(window, {
  V2TenantHome, V2PayRent, V2LateGrace, V2LatePayOrQuit, V2Maintenance, V2Recert,
});
