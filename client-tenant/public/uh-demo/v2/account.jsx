// V2 · Phase 9B — Notification center, preferences, and account hub.
// The "I'm in control of this product" surface area.

// ── 9B.1 Notification feed ───────────────────────────────────────────
function V2NotificationFeed() {
  const notifs = [
    {
      group: 'Today',
      items: [
        { icon: '💸', ch: 'push', cat: 'Rent', title: 'August rent is due in 17 days',
          body: 'Set up auto-pay to save $10/mo.', t: '8:14 AM', unread: true, tone: 'accent' },
        { icon: '✉', ch: 'in-app', cat: 'PM', title: 'Frank Hawkins messaged you',
          body: '"Just confirming our maintenance window Sep 15…"', t: '7:02 AM', unread: true, tone: 'sage' },
      ],
    },
    {
      group: 'Yesterday',
      items: [
        { icon: '🔧', ch: 'sms', cat: 'Maintenance', title: 'Work order #WO-26-1187 scheduled',
          body: 'Sep 15 · 10–12 · sink drip', t: 'Jul 14 · 4:21 PM', tone: 'neutral' },
        { icon: '📊', ch: 'email', cat: 'Compliance', title: 'Annual recert opens in 90 days',
          body: 'We\'ll guide you · no action yet', t: 'Jul 14 · 9:00 AM', tone: 'sage' },
      ],
    },
    {
      group: 'Earlier this week',
      items: [
        { icon: '🔑', ch: 'push', cat: 'Move-in', title: 'Welcome home, Marisol',
          body: 'You\'re officially a Universal Housing tenant.', t: 'Jul 15', tone: 'sage' },
        { icon: '⚡', ch: 'sms', cat: 'Utilities', title: 'NV Energy confirmed for Jul 14',
          body: 'Account in your name · all set', t: 'Jul 13', tone: 'sage' },
      ],
    },
  ];

  return (
    <MobileFrame label="Notifications · feed · 2 unread" h={2000}>
      <div style={{ padding: '10px 20px 14px', background: HF.paper, borderBottom: `1px solid ${HF.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button style={{
            width: 36, height: 36, borderRadius: HF.r.pill, background: HF.cream,
            border: `1px solid ${HF.border}`, cursor: 'pointer',
            display: 'grid', placeItems: 'center',
          }}><Icon name="arrowLeft" size={16} color={HF.ink} /></button>
          <H3 style={{ fontSize: 16, flex: 1 }}>Notifications</H3>
          <button style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            fontFamily: HF.body, fontSize: 12, fontWeight: 700, color: HF.accent,
          }}>Mark all read</button>
        </div>
      </div>

      <div style={{ padding: '14px 20px 8px', background: HF.cream }}>
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
          {[
            { l: 'All', count: 12, active: true },
            { l: 'Rent', count: 4 },
            { l: 'Maintenance', count: 3 },
            { l: 'PM messages', count: 2 },
            { l: 'Compliance', count: 3 },
          ].map((c, i) => (
            <Chip key={i} active={c.active}>{c.l} · {c.count}</Chip>
          ))}
        </div>
      </div>

      <div style={{ padding: '8px 20px 110px' }}>
        {notifs.map((group, gi) => (
          <div key={gi} style={{ marginTop: 14 }}>
            <Eyebrow color={HF.ink3}>{group.group}</Eyebrow>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {group.items.map((n, i) => (
                <Surface key={i} style={{
                  borderColor: n.unread ? HF.accent : HF.border,
                  background: n.unread ? HF.accentLo : HF.paper,
                }}>
                  <div style={{ padding: '12px 14px', display: 'flex', gap: 10 }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: HF.r.pill, flex: '0 0 36px',
                      background: HF.paper, border: `1.5px solid ${
                        n.tone === 'accent' ? HF.accent : n.tone === 'sage' ? HF.sage : HF.border
                      }`,
                      display: 'grid', placeItems: 'center',
                    }}>
                      <span style={{ fontSize: 16 }}>{n.icon}</span>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Tag tone={n.tone}>{n.cat}</Tag>
                        <P size={10} color={HF.ink3}>· {n.ch}</P>
                        {n.unread && (
                          <span style={{
                            width: 6, height: 6, borderRadius: 99, background: HF.accent, marginLeft: 'auto',
                          }} />
                        )}
                      </div>
                      <P size={13} weight={n.unread ? 700 : 600} style={{ marginTop: 4 }}>{n.title}</P>
                      <P size={11} color={HF.ink3} style={{ marginTop: 2, lineHeight: 1.4 }}>{n.body}</P>
                      <P size={10} color={HF.ink3} style={{ marginTop: 4 }}>{n.t}</P>
                    </div>
                  </div>
                </Surface>
              ))}
            </div>
          </div>
        ))}

        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <P size={11} color={HF.ink3}>You're all caught up · earlier in History</P>
        </div>
      </div>

      <TenantNav active="msg" />
    </MobileFrame>
  );
}

// ── 9B.2 Notification preferences ────────────────────────────────────
function V2NotificationPrefs() {
  const cats = [
    { cat: 'Rent reminders', sub: 'Due dates · auto-pay · receipts',
      push: true, email: true, sms: true },
    { cat: 'Maintenance updates', sub: 'Work order status · scheduling',
      push: true, email: true, sms: false },
    { cat: 'Application status', sub: 'Waitlist moves · PM review',
      push: true, email: true, sms: true },
    { cat: 'PM messages', sub: 'Direct messages from Frank',
      push: true, email: false, sms: true },
    { cat: 'Compliance & legal', sub: 'Recerts · evictions · violations',
      push: true, email: true, sms: true, required: true },
    { cat: 'Community announcements', sub: 'Weather · utility outages · events',
      push: true, email: true, sms: false },
    { cat: 'Promotions & nudges', sub: 'Auto-pay savings · new properties',
      push: false, email: true, sms: false },
  ];
  const Toggle = ({ on, disabled }) => (
    <div style={{
      width: 36, height: 22, borderRadius: HF.r.pill,
      background: disabled ? HF.border : on ? HF.sage : HF.border,
      position: 'relative', flex: '0 0 36px',
      opacity: disabled ? 0.6 : 1,
    }}>
      <div style={{
        position: 'absolute', top: 2, left: on ? 16 : 2,
        width: 18, height: 18, borderRadius: HF.r.pill, background: HF.paper,
        boxShadow: HF.shadow.xs,
      }} />
    </div>
  );

  return (
    <MobileFrame label="Notification preferences · per category × channel" h={2100}>
      <div style={{ padding: '10px 20px 14px', background: HF.paper, borderBottom: `1px solid ${HF.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button style={{
            width: 36, height: 36, borderRadius: HF.r.pill, background: HF.cream,
            border: `1px solid ${HF.border}`, cursor: 'pointer',
            display: 'grid', placeItems: 'center',
          }}><Icon name="arrowLeft" size={16} color={HF.ink} /></button>
          <H3 style={{ fontSize: 16, flex: 1 }}>Notification preferences</H3>
        </div>
      </div>

      <div style={{ padding: '20px 20px 100px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <P size={12} color={HF.ink3} style={{ lineHeight: 1.5 }}>
          Control how Universal Housing reaches you. Compliance + legal notices are
          required — we can't turn those off.
        </P>

        {/* Quiet hours */}
        <Surface>
          <div style={{ padding: '14px 16px' }}>
            <Eyebrow color={HF.ink3}>Quiet hours</Eyebrow>
            <div style={{
              marginTop: 8, display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <span style={{ fontSize: 22 }}>🌙</span>
              <div style={{ flex: 1 }}>
                <P size={12} weight={700}>10:00 PM – 7:00 AM</P>
                <P size={10} color={HF.ink3}>Mon–Sun · only critical alerts come through</P>
              </div>
              <Toggle on={true} />
            </div>
          </div>
        </Surface>

        {/* Channels matrix header */}
        <Surface>
          <div style={{
            padding: '12px 14px', background: HF.cream, borderBottom: `1px solid ${HF.border}`,
            display: 'grid', gridTemplateColumns: '1fr 40px 40px 40px', gap: 4, alignItems: 'center',
          }}>
            <Eyebrow color={HF.ink3}>Category</Eyebrow>
            {['Push', 'Email', 'SMS'].map(l => (
              <P key={l} size={9} color={HF.ink3} weight={700} style={{ textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {l}
              </P>
            ))}
          </div>
          {cats.map((c, i) => (
            <div key={i} style={{
              padding: '12px 14px', borderBottom: i === cats.length - 1 ? 'none' : `1px solid ${HF.border}`,
              display: 'grid', gridTemplateColumns: '1fr 40px 40px 40px', gap: 4, alignItems: 'center',
            }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <P size={12} weight={700}>{c.cat}</P>
                  {c.required && <Tag tone="warn" style={{ padding: '1px 5px', fontSize: 9 }}>Required</Tag>}
                </div>
                <P size={10} color={HF.ink3} style={{ marginTop: 2 }}>{c.sub}</P>
              </div>
              <div style={{ display: 'grid', placeItems: 'center' }}><Toggle on={c.push} disabled={c.required} /></div>
              <div style={{ display: 'grid', placeItems: 'center' }}><Toggle on={c.email} disabled={c.required} /></div>
              <div style={{ display: 'grid', placeItems: 'center' }}><Toggle on={c.sms} disabled={c.required} /></div>
            </div>
          ))}
        </Surface>

        {/* Language */}
        <Surface>
          <div style={{ padding: '14px 16px' }}>
            <Eyebrow color={HF.ink3}>Language for notifications</Eyebrow>
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
          </div>
        </Surface>

        <P size={11} color={HF.ink3} style={{ lineHeight: 1.5 }}>
          We never sell your contact info. SMS rates may apply per your carrier.
        </P>
      </div>
    </MobileFrame>
  );
}

// ── 9B.3 Account / profile ───────────────────────────────────────────
function V2Account() {
  return (
    <MobileFrame label="Account · profile + payment methods" h={2200}>
      <div style={{ padding: '10px 20px 14px', background: HF.paper, borderBottom: `1px solid ${HF.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button style={{
            width: 36, height: 36, borderRadius: HF.r.pill, background: HF.cream,
            border: `1px solid ${HF.border}`, cursor: 'pointer',
            display: 'grid', placeItems: 'center',
          }}><Icon name="arrowLeft" size={16} color={HF.ink} /></button>
          <H3 style={{ fontSize: 16, flex: 1 }}>My account</H3>
        </div>
      </div>

      <div style={{ padding: '20px 20px 100px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Profile header */}
        <Surface raised>
          <div style={{ padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 64, height: 64, borderRadius: HF.r.pill, background: HF.accentLo,
              border: `2px solid ${HF.accent}`, color: HF.accent,
              display: 'grid', placeItems: 'center', flex: '0 0 64px',
              fontFamily: HF.display, fontWeight: 800, fontSize: 24,
            }}>MC</div>
            <div style={{ flex: 1 }}>
              <H2 style={{ fontSize: 20 }}>Marisol R. Cabrera</H2>
              <P size={12} color={HF.ink3}>Juan Garcia · Unit 214 · since Jul 15, 2026</P>
              <Tag tone="ok" style={{ marginTop: 6 }}>● Active tenant</Tag>
            </div>
          </div>
        </Surface>

        {/* Household */}
        <Surface>
          <div style={{ padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <Eyebrow color={HF.ink3}>Household</Eyebrow>
              <button style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                fontFamily: HF.body, fontSize: 11, fontWeight: 700, color: HF.accent,
              }}>Manage →</button>
            </div>
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { name: 'Marisol R. Cabrera', sub: 'Head of household · 58', tag: 'You' },
                { name: 'Sofia Cabrera', sub: 'Daughter · 14 · minor', tag: 'Dependent' },
              ].map((m, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 0', borderTop: i === 0 ? 'none' : `1px dotted ${HF.border}`,
                }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: HF.r.pill, background: HF.cream,
                    border: `1px solid ${HF.border}`, display: 'grid', placeItems: 'center',
                    flex: '0 0 32px', fontFamily: HF.display, fontWeight: 700, fontSize: 11,
                  }}>{m.name.split(' ').map(n => n[0]).slice(0, 2).join('')}</div>
                  <div style={{ flex: 1 }}>
                    <P size={12} weight={700}>{m.name}</P>
                    <P size={10} color={HF.ink3}>{m.sub}</P>
                  </div>
                  <Tag tone="neutral">{m.tag}</Tag>
                </div>
              ))}
            </div>
          </div>
        </Surface>

        {/* Payment methods · Debit + ACH only */}
        <Surface>
          <div style={{ padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <Eyebrow color={HF.ink3}>Payment methods · debit or ACH only</Eyebrow>
              <button style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                fontFamily: HF.body, fontSize: 11, fontWeight: 700, color: HF.accent,
              }}>+ Add</button>
            </div>
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{
                padding: '10px 12px', borderRadius: HF.r.md,
                border: `1.5px solid ${HF.accent}`, background: HF.accentLo,
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <div style={{
                  width: 40, height: 28, borderRadius: 4, background: HF.ink, color: HF.paper,
                  display: 'grid', placeItems: 'center', fontFamily: HF.display, fontWeight: 800, fontSize: 9,
                  flex: '0 0 40px',
                }}>VISA</div>
                <div style={{ flex: 1 }}>
                  <P size={12} weight={700} style={{ fontFamily: HF.mono }}>•••• 4242</P>
                  <P size={10} color={HF.ink3}>Debit · expires 12/27</P>
                </div>
                <Tag tone="accent">Default</Tag>
              </div>
              <div style={{
                padding: '10px 12px', borderRadius: HF.r.md,
                border: `1px solid ${HF.border}`, background: HF.paper,
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <div style={{
                  width: 40, height: 28, borderRadius: 4, background: HF.sage, color: HF.paper,
                  display: 'grid', placeItems: 'center', fontFamily: HF.display, fontWeight: 800, fontSize: 9,
                  flex: '0 0 40px',
                }}>ACH</div>
                <div style={{ flex: 1 }}>
                  <P size={12} weight={700} style={{ fontFamily: HF.mono }}>Wells Fargo •••• 8821</P>
                  <P size={10} color={HF.ink3}>Bank transfer · checking</P>
                </div>
                <Tag tone="sage">Auto-pay</Tag>
              </div>
            </div>
            <P size={10} color={HF.ink3} style={{ marginTop: 8, lineHeight: 1.4 }}>
              Per lease §2.A — cash and personal checks are not accepted.
            </P>
          </div>
        </Surface>

        {/* Settings list */}
        <Surface>
          <div style={{ padding: '4px 0' }}>
            {[
              { icon: '🔔', l: 'Notifications', sub: '7 categories · 3 channels', target: 'acct-prefs' },
              { icon: '♿', l: 'Accessibility', sub: 'Voice readout · larger text', target: 'pol-a11y' },
              { icon: '🌐', l: 'Language', sub: 'English', target: 'pol-a11y' },
              { icon: '🔐', l: 'Security & MFA', sub: 'Face ID enabled · backup code set', target: 'acct-profile' },
              { icon: '📜', l: 'Documents', sub: 'Lease · receipts · audit trail', target: 'docs' },
              { icon: '❓', l: 'Help & support', sub: 'AI chat · PM · NV Legal Services', target: 'pol-chat' },
            ].map((row, i, arr) => (
              <span key={i} data-uh-routed="true"
                    onClick={() => window.__UH_GO_TO__ && window.__UH_GO_TO__(row.target)}
                    style={{ display: 'block' }}>
                <div style={{
                  padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12,
                  borderTop: i === 0 ? 'none' : `1px solid ${HF.border}`,
                  cursor: 'pointer',
                }}>
                  <span style={{ fontSize: 18, width: 24, textAlign: 'center' }}>{row.icon}</span>
                  <div style={{ flex: 1 }}>
                    <P size={13} weight={600}>{row.l}</P>
                    <P size={10} color={HF.ink3}>{row.sub}</P>
                  </div>
                  <Icon name="arrow" size={14} color={HF.ink3} />
                </div>
              </span>
            ))}
          </div>
        </Surface>

        <Surface>
          <div style={{ padding: '14px 16px' }}>
            <button style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              fontFamily: HF.body, fontSize: 13, fontWeight: 700, color: HF.err,
              width: '100%', textAlign: 'left',
            }}>Sign out of Universal Housing</button>
          </div>
        </Surface>
      </div>

      <TenantNav />
    </MobileFrame>
  );
}

Object.assign(window, { V2NotificationFeed, V2NotificationPrefs, V2Account });
