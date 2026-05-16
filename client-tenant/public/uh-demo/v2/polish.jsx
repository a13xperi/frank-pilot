// V2 · Phase 8 cross-cutting polish — bilingual EN/ES toggle, voice readout
// settings, AI chat assistant, first-time onboarding tour.
// These are the surface-area patterns the rest of the app inherits.

// ── 8.1 Spanish variant of tenant home ───────────────────────────────
function V2TenantHomeES() {
  return (
    <MobileFrame label="Tenant home · Spanish (ES)" h={2100}>
      <div style={{ padding: '8px 20px 14px', background: HF.paper, borderBottom: `1px solid ${HF.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: HF.r.sm, background: HF.accent, color: HF.paper,
            display: 'grid', placeItems: 'center', fontFamily: HF.display, fontWeight: 800, fontSize: 15,
          }}>U</div>
          <div style={{ flex: 1 }}>
            <P size={11} color={HF.ink3}>Bienvenida a casa,</P>
            <H3 style={{ fontSize: 16 }}>Marisol</H3>
          </div>
          <div style={{
            padding: '4px 8px', borderRadius: HF.r.sm, background: HF.accentLo, border: `1px solid ${HF.accent}`,
          }}>
            <span style={{ fontFamily: HF.body, fontSize: 10, fontWeight: 700, color: HF.accent }}>EN | <b>ES</b></span>
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

        <Surface raised style={{ background: HF.ok, border: 'none', color: HF.paper }}>
          <div style={{ padding: '18px 20px' }}>
            <Eyebrow color="rgba(255,255,255,0.85)">Saldo actual</Eyebrow>
            <span style={{ fontFamily: HF.display, fontWeight: 800, fontSize: 38, color: HF.paper, letterSpacing: '-0.02em' }}>$964.00</span>
            <P size={11} color="rgba(255,255,255,0.85)" style={{ marginTop: 4 }}>
              Vence 1 ago · en 17 días · pago automático: desactivado
            </P>
            <div style={{ height: 12 }} />
            <span data-uh-routed="true" onClick={() => window.__UH_GO_TO__ && window.__UH_GO_TO__('pay-rent')}>
              <Button variant="secondary" size="md" style={{ background: HF.paper, color: HF.ok, border: 'none' }}>
                Pagar renta
                <Icon name="arrow" size={14} color={HF.ok} style={{ marginLeft: 4 }} />
              </Button>
            </span>
          </div>
        </Surface>

        <Surface style={{ background: HF.accentLo, borderColor: '#F3D7CB' }}>
          <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <span style={{ fontSize: 24 }}>💸</span>
            <div style={{ flex: 1 }}>
              <H3 style={{ fontSize: 14, color: HF.accent }}>Activa pago automático · ahorra $10/mes</H3>
              <P size={11} color={HF.ink2} style={{ marginTop: 2, lineHeight: 1.4 }}>
                Nunca te atrases. $10 de descuento cada mes. Recupera tu tarifa de solicitud en ~7 meses.
              </P>
              <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
                <span data-uh-routed="true" onClick={() => window.__UH_GO_TO__ && window.__UH_GO_TO__('acct-profile')}>
                  <Button variant="primary" size="sm">Activar</Button>
                </span>
                <Button variant="ghost" size="sm">Más tarde</Button>
              </div>
            </div>
          </div>
        </Surface>

        <Surface>
          <div style={{ padding: '14px 16px' }}>
            <Eyebrow color={HF.ink3}>Próximas facturas</Eyebrow>
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[
                { icon: '$', l: 'Renta', sub: 'GPMG · 1 ago', amt: '$964.00', days: 17, primary: true },
                { icon: '🔥', l: 'Gas', sub: 'Southwest Gas · 8 ago', amt: '$31.40', days: 24 },
                { icon: '⚡', l: 'Electricidad', sub: 'NV Energy · 14 ago', amt: '$96.20', days: 30 },
              ].map((b, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 10px', borderRadius: HF.r.sm,
                  background: b.primary ? HF.accentLo : HF.cream,
                  border: `1px solid ${b.primary ? '#F3D7CB' : HF.border}`,
                }}>
                  <span style={{ fontSize: 14, width: 20, textAlign: 'center' }}>{b.icon}</span>
                  <div style={{ flex: 1 }}>
                    <P size={12} weight={700}>{b.l}</P>
                    <P size={10} color={HF.ink3}>{b.sub}</P>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ fontFamily: HF.display, fontWeight: 800, fontSize: 13, color: b.primary ? HF.accent : HF.ink }}>{b.amt}</span>
                    <P size={10} color={HF.ink3}>en {b.days}d</P>
                  </div>
                </div>
              ))}
            </div>
            <P size={10} color={HF.ink3} style={{ marginTop: 10, lineHeight: 1.4 }}>
              💡 La recertificación anual se gestiona por reglas — te avisaremos por SMS · correo · push 120 días antes (abr 2027).
            </P>
          </div>
        </Surface>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Surface>
            <div style={{ padding: '12px 14px' }}>
              <Eyebrow color={HF.ink3}>Reparaciones</Eyebrow>
              <H1 style={{ fontSize: 24, marginTop: 4 }}>0</H1>
              <P size={10} color={HF.ink3}>Todo en orden</P>
            </div>
          </Surface>
          <Surface>
            <div style={{ padding: '12px 14px' }}>
              <Eyebrow color={HF.ink3}>Historial de renta</Eyebrow>
              <H1 style={{ fontSize: 24, marginTop: 4, color: HF.ok }}>1 / 1</H1>
              <P size={10} color={HF.ok} weight={700}>✓ A tiempo</P>
            </div>
          </Surface>
        </div>
      </div>

      <TenantNav active="home" />
    </MobileFrame>
  );
}

// ── 8.2 Accessibility / voice readout settings ──────────────────────
function V2Accessibility() {
  return (
    <MobileFrame label="Accessibility · voice readout · Section 508" h={1800}>
      <div style={{ padding: '10px 20px 14px', background: HF.paper, borderBottom: `1px solid ${HF.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button style={{
            width: 36, height: 36, borderRadius: HF.r.pill, background: HF.cream,
            border: `1px solid ${HF.border}`, cursor: 'pointer',
            display: 'grid', placeItems: 'center',
          }}><Icon name="arrowLeft" size={16} color={HF.ink} /></button>
          <H3 style={{ fontSize: 16, flex: 1 }}>Accessibility</H3>
        </div>
      </div>

      <div style={{ padding: '20px 20px 100px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <H2 style={{ fontSize: 22 }}>Make this app work for you</H2>
          <P size={13} color={HF.ink3} style={{ marginTop: 4 }}>
            Universal Housing meets Section 508 + WCAG AA. Personalize what you need.
          </P>
        </div>

        {/* Voice readout — primary */}
        <Surface raised style={{ borderColor: HF.sage, background: HF.sageLo }}>
          <div style={{ padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 44, height: 44, borderRadius: HF.r.pill, background: HF.sage, color: HF.paper,
                display: 'grid', placeItems: 'center', flex: '0 0 44px',
              }}>
                <span style={{ fontSize: 22 }}>🔊</span>
              </div>
              <div style={{ flex: 1 }}>
                <H3 style={{ fontSize: 14 }}>Voice readout</H3>
                <P size={11} color={HF.ink3}>Reads every screen aloud · EN + ES</P>
              </div>
              <div style={{
                width: 48, height: 28, borderRadius: HF.r.pill, background: HF.sage,
                position: 'relative', cursor: 'pointer', flex: '0 0 48px',
              }}>
                <div style={{
                  position: 'absolute', right: 2, top: 2, width: 24, height: 24,
                  borderRadius: HF.r.pill, background: HF.paper, boxShadow: HF.shadow.xs,
                }} />
              </div>
            </div>
            <div style={{
              marginTop: 12, padding: '8px 10px', borderRadius: HF.r.sm,
              background: HF.paper, border: `1px solid ${HF.sage}`,
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <div style={{
                width: 28, height: 28, borderRadius: HF.r.pill, background: HF.sage, color: HF.paper,
                display: 'grid', placeItems: 'center',
              }}>▶</div>
              <div style={{ flex: 1 }}>
                <P size={11} weight={700}>Now reading · Tenant home</P>
                <div style={{ height: 4, marginTop: 4, background: HF.sageLo, borderRadius: 99, overflow: 'hidden' }}>
                  <div style={{ width: '34%', height: '100%', background: HF.sage }} />
                </div>
              </div>
              <P size={11} color={HF.ink3}>34s / 1:42</P>
            </div>
          </div>
        </Surface>

        {/* Other a11y options */}
        <Surface>
          <div style={{ padding: '6px 16px' }}>
            {[
              { icon: '🔍', l: 'Larger text', sub: 'Up to 200% scale', on: true },
              { icon: '◐', l: 'High-contrast colors', sub: 'WCAG AAA shade pairs', on: false },
              { icon: '⏸', l: 'Reduce motion', sub: 'Disable animations', on: true },
              { icon: '🎯', l: 'Larger tap targets', sub: '48pt minimum', on: true },
              { icon: '⌨', l: 'External keyboard support', sub: 'Full nav with tab/arrows', on: false },
            ].map((row, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 0', borderTop: i === 0 ? 'none' : `1px solid ${HF.border}`,
              }}>
                <span style={{ fontSize: 18, width: 28, textAlign: 'center' }}>{row.icon}</span>
                <div style={{ flex: 1 }}>
                  <P size={12} weight={700}>{row.l}</P>
                  <P size={10} color={HF.ink3}>{row.sub}</P>
                </div>
                <div style={{
                  width: 40, height: 24, borderRadius: HF.r.pill,
                  background: row.on ? HF.sage : HF.border,
                  position: 'relative', flex: '0 0 40px',
                }}>
                  <div style={{
                    position: 'absolute', top: 2, left: row.on ? 18 : 2,
                    width: 20, height: 20, borderRadius: HF.r.pill, background: HF.paper,
                    boxShadow: HF.shadow.xs, transition: 'left .15s',
                  }} />
                </div>
              </div>
            ))}
          </div>
        </Surface>

        {/* Language */}
        <Surface>
          <div style={{ padding: '14px 16px' }}>
            <Eyebrow color={HF.ink3}>Language</Eyebrow>
            <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <button style={{
                padding: '12px', borderRadius: HF.r.md, cursor: 'pointer',
                background: HF.accent, color: HF.paper, border: 'none',
                fontFamily: HF.body, fontWeight: 700, fontSize: 14,
              }}>English</button>
              <button style={{
                padding: '12px', borderRadius: HF.r.md, cursor: 'pointer',
                background: HF.paper, color: HF.ink, border: `1.5px solid ${HF.border}`,
                fontFamily: HF.body, fontWeight: 600, fontSize: 14,
              }}>Español</button>
            </div>
            <P size={10} color={HF.ink3} style={{ marginTop: 8 }}>
              Affects every screen, voice readout, and PM messages.
            </P>
          </div>
        </Surface>

        <Surface style={{ background: HF.cream }}>
          <div style={{ padding: '12px 14px' }}>
            <P size={11} color={HF.ink2} style={{ lineHeight: 1.5 }}>
              Need more help? Free assistive technology support via the Nevada Disability Advocacy Center:
              <b style={{ color: HF.accent }}> (775) 333-7878</b>
            </P>
          </div>
        </Surface>
      </div>
    </MobileFrame>
  );
}

// ── 8.3 AI Chat Assistant ────────────────────────────────────────────
function V2ChatAssistant() {
  const messages = [
    { from: 'ai', text: 'Hi Marisol! I\'m the Universal Housing assistant. I can answer questions about your application, rent, or anything you see in the app.', t: '2:14 PM' },
    { from: 'me', text: 'when is my next rent due?', t: '2:15 PM' },
    { from: 'ai', text: 'Your August rent of **$964.00** is due **Aug 1, 2026** — that\'s in 17 days. Your auto-pay is currently off. Want me to walk you through enrolling? You\'ll save $10/mo.', t: '2:15 PM', actions: [
      { label: 'Enroll in auto-pay', target: 'acct-profile' },
      { label: 'How is rent calculated?', target: 'rent-faq' },
    ] },
    { from: 'me', text: 'how is rent calculated?', t: '2:16 PM' },
    { from: 'ai', text: 'Great question. Your rent is set by **Section 42 LIHTC rules** based on your annual income and household size. The short version:\n\n1. We use your verified annual income.\n2. We subtract any allowed deductions (you have $480 for Sofia).\n3. We calculate 30% of the adjusted monthly figure.\n4. That number is capped at the LIHTC max for a 2BR at Juan Garcia ($964/mo).\n\nThe cap is why your rent is $964 instead of the higher amount.', t: '2:16 PM', actions: [
      { label: 'Read full explanation', target: 'rent-faq' },
      { label: 'Show my calc tape', target: 'calc-tape' },
    ] },
  ];

  return (
    <MobileFrame label="AI chat assistant · context-aware" h={1900}>
      <div style={{ padding: '10px 20px 14px', background: HF.paper, borderBottom: `1px solid ${HF.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button style={{
            width: 36, height: 36, borderRadius: HF.r.pill, background: HF.cream,
            border: `1px solid ${HF.border}`, cursor: 'pointer',
            display: 'grid', placeItems: 'center',
          }}><Icon name="arrowLeft" size={16} color={HF.ink} /></button>
          <div style={{
            width: 38, height: 38, borderRadius: HF.r.pill, background: HF.sage, color: HF.paper,
            display: 'grid', placeItems: 'center', fontFamily: HF.display, fontWeight: 800, fontSize: 15,
            flex: '0 0 38px',
          }}>U</div>
          <div style={{ flex: 1 }}>
            <H3 style={{ fontSize: 14 }}>Universal Housing</H3>
            <P size={10} color={HF.ok} weight={700}>● Online · knows your account</P>
          </div>
          <button style={{
            padding: '6px 10px', borderRadius: HF.r.sm, background: HF.paper,
            border: `1px solid ${HF.border}`, cursor: 'pointer',
            fontFamily: HF.body, fontWeight: 700, fontSize: 11,
          }}>Talk to PM</button>
        </div>
      </div>

      <div style={{ padding: '20px 20px 120px', display: 'flex', flexDirection: 'column', gap: 14, background: HF.cream }}>
        {/* Date stamp */}
        <P size={10} color={HF.ink3} weight={600} style={{ textAlign: 'center' }}>
          Today · Jul 15 · 2:14 PM
        </P>

        {messages.map((m, i) => (
          <div key={i} style={{
            display: 'flex', justifyContent: m.from === 'me' ? 'flex-end' : 'flex-start',
          }}>
            <div style={{ maxWidth: '85%' }}>
              {m.from === 'ai' && (
                <P size={10} color={HF.ink3} style={{ marginLeft: 4, marginBottom: 4 }}>Assistant · {m.t}</P>
              )}
              <div style={{
                padding: '10px 14px', borderRadius: HF.r.lg,
                background: m.from === 'me' ? HF.accent : HF.paper,
                color: m.from === 'me' ? HF.paper : HF.ink,
                border: m.from === 'me' ? 'none' : `1px solid ${HF.border}`,
                borderTopRightRadius: m.from === 'me' ? 6 : HF.r.lg,
                borderTopLeftRadius: m.from === 'ai' ? 6 : HF.r.lg,
              }}>
                <P size={13} color={m.from === 'me' ? HF.paper : HF.ink} style={{ lineHeight: 1.5, whiteSpace: 'pre-line' }}>
                  {m.text.split('**').map((chunk, j) => j % 2 === 0 ? chunk : <b key={j}>{chunk}</b>)}
                </P>
              </div>
              {m.actions && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8, marginLeft: 4 }}>
                  {m.actions.map((a, k) => (
                    <button key={k} data-uh-routed="true"
                      onClick={() => window.__UH_GO_TO__ && window.__UH_GO_TO__(a.target)}
                      style={{
                      padding: '6px 12px', borderRadius: HF.r.pill,
                      background: HF.paper, border: `1.5px solid ${HF.accent}`,
                      color: HF.accent, cursor: 'pointer',
                      fontFamily: HF.body, fontWeight: 700, fontSize: 12,
                    }}>{a.label}</button>
                  ))}
                </div>
              )}
              {m.from === 'me' && (
                <P size={10} color={HF.ink3} style={{ marginRight: 4, marginTop: 4, textAlign: 'right' }}>{m.t}</P>
              )}
            </div>
          </div>
        ))}

        {/* Typing */}
        <div style={{ display: 'flex' }}>
          <div style={{
            padding: '12px 16px', borderRadius: HF.r.lg, background: HF.paper, border: `1px solid ${HF.border}`,
            display: 'flex', gap: 4,
          }}>
            {[0, 1, 2].map(i => (
              <span key={i} style={{
                width: 6, height: 6, borderRadius: 99, background: HF.ink3,
                opacity: 0.4 + i * 0.2,
              }} />
            ))}
          </div>
        </div>
      </div>

      {/* Composer */}
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        background: HF.paper, borderTop: `1px solid ${HF.border}`,
        padding: '12px 16px 22px',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '4px 4px 4px 14px', borderRadius: HF.r.pill,
          background: HF.cream, border: `1px solid ${HF.border}`,
        }}>
          <span style={{ fontFamily: HF.body, fontSize: 13, color: HF.ink3, flex: 1 }}>Ask anything…</span>
          <button style={{
            width: 36, height: 36, borderRadius: HF.r.pill, border: 'none', cursor: 'pointer',
            background: HF.cream, display: 'grid', placeItems: 'center',
          }}>🎤</button>
          <button style={{
            width: 36, height: 36, borderRadius: HF.r.pill, border: 'none', cursor: 'pointer',
            background: HF.accent, color: HF.paper, display: 'grid', placeItems: 'center',
          }}>
            <Icon name="arrow" size={14} color={HF.paper} />
          </button>
        </div>
        <P size={9} color={HF.ink3} style={{ textAlign: 'center', marginTop: 6 }}>
          AI may make mistakes · for legal advice talk to a PM or NV Legal Services
        </P>
      </div>
    </MobileFrame>
  );
}

// ── 8.4 First-time tenant tour ───────────────────────────────────────
function V2OnboardingTour() {
  return (
    <MobileFrame label="First-time tour · Day 90 · tip 3 of 5" h={1900}>
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
        </div>
      </div>

      <div style={{
        padding: '14px 20px 30px', display: 'flex', flexDirection: 'column', gap: 14,
        opacity: 0.35,
      }}>
        <PropertyAnchor />
        <Surface raised style={{ background: HF.ok, border: 'none', height: 140 }} />
        <Surface style={{ height: 100 }} />
        <Surface style={{ height: 220 }} />
      </div>

      {/* Overlay backdrop */}
      <div style={{
        position: 'absolute', top: 60, left: 0, right: 0, bottom: 0,
        background: 'rgba(31, 26, 18, 0.55)', backdropFilter: 'blur(2px)',
        pointerEvents: 'none',
      }} />

      {/* Spotlight + tooltip */}
      <div style={{
        position: 'absolute', top: 270, left: 14, right: 14,
        borderRadius: HF.r.lg, height: 180,
        boxShadow: '0 0 0 9999px rgba(31,26,18,0.55), 0 0 0 4px rgba(255,255,255,0.6)',
        pointerEvents: 'none',
        background: 'transparent',
      }} />

      {/* Tooltip card */}
      <div style={{
        position: 'absolute', top: 480, left: 20, right: 20,
        padding: 16, borderRadius: HF.r.lg,
        background: HF.paper, boxShadow: HF.shadow.lg,
      }}>
        <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} style={{
              width: i === 2 ? 24 : 6, height: 6, borderRadius: 99,
              background: i <= 2 ? HF.accent : HF.border,
            }} />
          ))}
        </div>
        <Eyebrow>Tip 3 of 5</Eyebrow>
        <H3 style={{ fontSize: 17, marginTop: 6 }}>Pay rent in seconds</H3>
        <P size={13} color={HF.ink2} style={{ marginTop: 6, lineHeight: 1.5 }}>
          Your balance lives here. Tap "Pay rent" any time — credit or debit card.
          Pro tip: enroll in auto-pay below and save <b>$10/mo</b> for as long as it's active.
        </P>
        <div style={{
          marginTop: 12, paddingTop: 12, borderTop: `1px solid ${HF.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <button data-uh-routed="true"
            onClick={() => window.__UH_GO_TO__ && window.__UH_GO_TO__('tenant-home')}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              fontFamily: HF.body, fontSize: 12, fontWeight: 700, color: HF.ink3,
              textDecoration: 'underline',
          }}>Skip tour</button>
          <div style={{ display: 'flex', gap: 6 }}>
            <Button variant="secondary" size="sm">← Back</Button>
            <span data-uh-routed="true" onClick={() => window.__UH_GO_TO__ && window.__UH_GO_TO__('maintenance')}>
              <Button variant="primary" size="sm">
                Next
                <Icon name="arrow" size={12} color={HF.paper} style={{ marginLeft: 2 }} />
              </Button>
            </span>
          </div>
        </div>
      </div>

      {/* Tour map */}
      <div style={{
        position: 'absolute', bottom: 100, left: 20, right: 20,
        padding: 12, borderRadius: HF.r.lg,
        background: HF.paper, boxShadow: HF.shadow.lg, border: `1px solid ${HF.border}`,
      }}>
        <Eyebrow color={HF.ink3}>What you'll learn</Eyebrow>
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[
            { l: 'Where your property info lives', done: true },
            { l: 'Understanding your balance', done: true },
            { l: 'Paying rent in seconds', current: true },
            { l: 'Requesting maintenance', done: false },
            { l: 'Annual recert + renewal', done: false },
          ].map((row, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 18, height: 18, borderRadius: HF.r.pill,
                background: row.done ? HF.ok : row.current ? HF.accent : HF.paper,
                border: `1.5px solid ${row.done ? HF.ok : row.current ? HF.accent : HF.border}`,
                color: HF.paper, display: 'grid', placeItems: 'center',
              }}>
                {row.done && <Icon name="check" size={11} color={HF.paper} />}
                {row.current && <span style={{ width: 6, height: 6, borderRadius: 99, background: HF.paper }} />}
              </div>
              <P size={11} weight={row.current ? 700 : 500} color={row.current ? HF.accent : row.done ? HF.ink2 : HF.ink3}>
                {row.l}
              </P>
            </div>
          ))}
        </div>
      </div>
    </MobileFrame>
  );
}

Object.assign(window, { V2TenantHomeES, V2Accessibility, V2ChatAssistant, V2OnboardingTour });
