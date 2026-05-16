// V2 · Applicant dashboards — what Marisol sees during the 30+ days she's
// waitlisted, then once her application enters PM review. Mobile-led.
// Phase 2 of the plan: 2.1 (waitlist), 2.3 (processing), 2.4 (documents),
// 2.5 (inbox).

// ── Shared PropertyAnchor strip — "the trap" ─────────────────────────
function PropertyAnchorStrip({ p, bed = '2BR', status = 'waitlist' }) {
  return (
    <Surface>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px' }}>
        <div style={{
          width: 56, height: 44, flex: '0 0 56px', borderRadius: HF.r.sm,
          background: `#c4b496 url(${p.photo}) center/cover`,
        }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <P size={13} weight={700} style={{
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{p.name}</P>
          <P size={11} color={HF.ink3}>{bed} · {p.neighborhood}</P>
        </div>
        <Tag tone={status === 'waitlist' ? 'warn' : status === 'processing' ? 'accent' : 'ok'}>
          {status === 'waitlist' ? `● ${p.waitlistMo}mo wait` :
           status === 'processing' ? '● Reviewing' : '● Active'}
        </Tag>
      </div>
    </Surface>
  );
}

// ── 2.1 Waitlist Dashboard (mobile) ──────────────────────────────────
function V2WaitlistDashboard() {
  const p = propBySlug('juan-garcia');
  return (
    <MobileFrame label="Waitlist · Day 31 · climbing to #1" h={2200}>
      <DashHeader greeting="Hi, Marisol" subtitle="Day 31 on the waitlist" />

      <div style={{ padding: '12px 20px 100px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <PropertyAnchorStrip p={p} bed="2BR" status="waitlist" />

        {/* Primary waitlist card */}
        <Surface raised style={{ background: HF.warnLo, borderColor: '#E8D6A8' }}>
          <div style={{ padding: '16px 18px' }}>
            <Eyebrow color="#6B4A11">Your spot · 2BR list at Juan Garcia</Eyebrow>
            <P size={11} color={HF.ink3} style={{ marginTop: 2 }}>
              This is ONE of several waitlists here. Each unit type has its own list.
            </P>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 12 }}>
              <span style={{ fontFamily: HF.display, fontWeight: 800, fontSize: 56, color: '#6B4A11', lineHeight: 1 }}>
                #12
              </span>
              <P size={13} color="#6B4A11" weight={600}>of 38 on the 2BR list</P>
            </div>
            <div style={{ marginTop: 8 }}>
              <Tag tone="ok">↑ 3 spots this month</Tag>
            </div>
            <div style={{
              marginTop: 14, paddingTop: 14, borderTop: `1px dashed #C0A368`,
            }}>
              <Eyebrow color="#6B4A11">Estimated wait</Eyebrow>
              <div style={{ fontFamily: HF.display, fontWeight: 800, fontSize: 18, color: '#6B4A11', marginTop: 2 }}>
                3–6 months
              </div>
            </div>
          </div>
        </Surface>

        {/* Climbing to #1 — bullish chart */}
        <Surface>
          <div style={{ padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="spark" size={18} color={HF.ok} />
              <H3 style={{ fontSize: 14 }}>Climbing to #1</H3>
              <span style={{ marginLeft: 'auto' }}><Tag tone="ok">+8 in 31d</Tag></span>
            </div>
            <div style={{ height: 8 }} />
            <svg viewBox="0 0 320 70" style={{ width: '100%', height: 70 }}>
              <defs>
                <linearGradient id="climb-v2" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={HF.ok} stopOpacity="0.4" />
                  <stop offset="100%" stopColor={HF.ok} stopOpacity="0" />
                </linearGradient>
              </defs>
              <polygon
                fill="url(#climb-v2)"
                points="0,58 40,52 80,48 120,42 160,34 200,26 240,20 280,12 320,6 320,70 0,70"
              />
              <polyline
                fill="none" stroke={HF.ok} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round"
                points="0,58 40,52 80,48 120,42 160,34 200,26 240,20 280,12 320,6"
              />
              {[0,40,80,120,160,200,240,280,320].map((x,i) => (
                <circle key={i} cx={x} cy={[58,52,48,42,34,26,20,12,6][i]} r="3" fill={HF.ok} />
              ))}
              <line x1="0" y1="4" x2="320" y2="4" stroke={HF.accent} strokeWidth="1.5" strokeDasharray="4 4" opacity="0.5" />
            </svg>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 4 }}>
              <P size={11} color={HF.ink3}>#20 → 31 days ago</P>
              <P size={12} weight={700} color={HF.ok}>↑ Today: #12</P>
              <P size={11} weight={700} color={HF.accent}>→ #1</P>
            </div>
          </div>
        </Surface>

        {/* Fastest path to move-in */}
        <Surface raised style={{ background: HF.accentLo, borderColor: '#F3D7CB' }}>
          <div style={{ padding: '16px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="spark" size={18} color={HF.accent} />
              <H3 style={{ fontSize: 16, color: HF.accent }}>Fastest path to move-in</H3>
            </div>
            <P size={12} color={HF.ink2} style={{ marginTop: 4 }}>
              You're already pre-qualified. These have shorter waits — or units open NOW.
            </P>

            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* MOVE NOW option */}
              <div style={{
                padding: 12, borderRadius: HF.r.md, background: HF.ok, color: HF.paper,
                position: 'relative',
              }}>
                <div style={{
                  position: 'absolute', top: -8, right: 10,
                  padding: '3px 8px', borderRadius: HF.r.pill,
                  background: HF.accent, color: HF.paper,
                  fontFamily: HF.body, fontWeight: 800, fontSize: 9, letterSpacing: '0.05em',
                }}>★ MOVE NOW</div>
                <P size={11} color="rgba(255,255,255,0.85)" weight={600}>2BR · Fletcher</P>
                <div style={{
                  display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 4,
                }}>
                  <span style={{ fontFamily: HF.display, fontWeight: 800, fontSize: 22, color: HF.paper }}>NOW</span>
                  <P size={11} color="rgba(255,255,255,0.85)">4 units open</P>
                </div>
                <P size={11} color="rgba(255,255,255,0.75)" style={{ marginTop: 6 }}>
                  same unit · move-in in 30 days
                </P>
                <div style={{ marginTop: 8 }}>
                  <span data-uh-routed="true" onClick={() => window.__UH_GO_TO__ && window.__UH_GO_TO__('apply-1')}>
                    <Button variant="secondary" size="sm" style={{ background: HF.paper, color: HF.ok }}>
                      Move me here
                      <Icon name="arrow" size={14} color={HF.ok} style={{ marginLeft: 4 }} />
                    </Button>
                  </span>
                </div>
              </div>

              {/* Other options */}
              {[
                { l: '3BR · Juan Garcia', wait: '~3 wk', cue: 'same property · #4 in queue', note: 'upsize, get in faster' },
                { l: '2BR · Sarann Knight', wait: '~6 wk', cue: '#7 in queue', note: 'family · similar to Juan Garcia' },
              ].map((row, i) => (
                <div key={i} style={{
                  padding: 12, borderRadius: HF.r.md, background: HF.paper,
                  border: `1px solid ${HF.accent}`,
                }}>
                  <P size={11} color={HF.ink2} weight={600}>{row.l}</P>
                  <div style={{
                    display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 4,
                  }}>
                    <span style={{ fontFamily: HF.display, fontWeight: 800, fontSize: 20, color: HF.accent }}>{row.wait}</span>
                    <P size={11} color={HF.ink3}>{row.cue}</P>
                  </div>
                  <P size={11} color={HF.ink3} style={{ marginTop: 4 }}>{row.note}</P>
                  <div style={{ marginTop: 8 }}>
                    <span data-uh-routed="true" onClick={() => window.__UH_GO_TO__ && window.__UH_GO_TO__('detail')}>
                      <Button variant="primary" size="sm">Add to my lists</Button>
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <div style={{
              marginTop: 12, padding: '8px 10px', borderRadius: HF.r.sm,
              background: HF.paper, border: `1px dashed ${HF.borderHi}`,
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span style={{ fontSize: 14 }}>🛡</span>
              <P size={11} color={HF.ink3} style={{ flex: 1 }}>
                You're auto-included while your app is active. We notify before any action.
              </P>
              <button style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                fontFamily: HF.body, fontSize: 11, fontWeight: 700, color: HF.ink3,
                textDecoration: 'underline',
              }}>manage</button>
            </div>
          </div>
        </Surface>

        {/* Application status quick */}
        <Surface>
          <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 38, height: 38, borderRadius: HF.r.pill, background: HF.okLo,
              display: 'grid', placeItems: 'center', flex: '0 0 38px',
            }}>
              <Icon name="check" size={18} color={HF.ok} />
            </div>
            <div style={{ flex: 1 }}>
              <P size={13} weight={700}>Application complete</P>
              <P size={11} color={HF.ink3}>#APP-26-9341 · $71.90 paid · 4/5 docs verified</P>
            </div>
            <Icon name="arrow" size={14} color={HF.ink3} />
          </div>
        </Surface>
      </div>

      <BottomTabs active="home" />
    </MobileFrame>
  );
}

// ── 2.3 Processing Dashboard (mobile) ────────────────────────────────
function V2ProcessingDashboard() {
  const p = propBySlug('juan-garcia');
  return (
    <MobileFrame label="Processing · Day 67 · PM reviewing" h={2000}>
      <DashHeader greeting="Hi, Marisol" subtitle="Your application is moving forward" />

      <div style={{ padding: '12px 20px 100px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <PropertyAnchorStrip p={p} bed="2BR" status="processing" />

        {/* Stage tracker — primary */}
        <Surface raised style={{ background: HF.accent, color: HF.paper, border: 'none' }}>
          <div style={{ padding: '16px 18px' }}>
            <Eyebrow color="rgba(255,255,255,0.85)">Application status</Eyebrow>
            <H2 style={{ fontSize: 20, color: HF.paper, marginTop: 6 }}>
              Step 3 of 5 · PM review
            </H2>
            <P size={12} color="rgba(255,255,255,0.85)" style={{ marginTop: 4 }}>
              Frank is reviewing your file. Typical turnaround: 2–3 business days.
            </P>

            <div style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {[
                  { l: 'Submitted', done: true },
                  { l: 'Docs', done: true },
                  { l: 'PM review', current: true },
                  { l: 'Lease', done: false },
                  { l: 'Move-in', done: false },
                ].map((step, i, arr) => (
                  <React.Fragment key={i}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: '0 0 auto' }}>
                      <div style={{
                        width: 28, height: 28, borderRadius: HF.r.pill,
                        background: step.done || step.current ? HF.paper : 'rgba(255,255,255,0.25)',
                        border: `2px solid ${HF.paper}`,
                        display: 'grid', placeItems: 'center',
                        fontFamily: HF.display, fontWeight: 800, fontSize: 11,
                        color: step.done || step.current ? HF.accent : HF.paper,
                      }}>
                        {step.done ? <Icon name="check" size={14} color={HF.accent} /> : (i + 1)}
                      </div>
                      <span style={{
                        marginTop: 4, fontFamily: HF.body, fontSize: 9,
                        fontWeight: step.current ? 700 : 500,
                        color: 'rgba(255,255,255,0.9)', textAlign: 'center',
                      }}>{step.l}</span>
                    </div>
                    {i < arr.length - 1 && (
                      <div style={{
                        flex: 1, height: 2, marginBottom: 18,
                        background: step.done ? HF.paper : 'rgba(255,255,255,0.3)',
                      }} />
                    )}
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>
        </Surface>

        {/* Docs status */}
        <Surface>
          <div style={{ padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <H3 style={{ fontSize: 14 }}>📁 Documents</H3>
              <span style={{ marginLeft: 'auto' }}>
                <button style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: HF.body, fontSize: 12, fontWeight: 700, color: HF.accent }}>
                  View →
                </button>
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 8 }}>
              <span style={{ fontFamily: HF.display, fontWeight: 800, fontSize: 32, color: HF.ok }}>5 / 5</span>
              <P size={12} color={HF.ok} weight={600}>
                <Icon name="check" size={12} color={HF.ok} /> Verified
              </P>
            </div>
          </div>
        </Surface>

        {/* Your PM */}
        <Surface>
          <div style={{ padding: '14px 16px' }}>
            <H3 style={{ fontSize: 14 }}>Your Property Manager</H3>
            <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 48, height: 48, borderRadius: HF.r.pill, background: HF.cream,
                border: `2px solid ${HF.border}`,
                display: 'grid', placeItems: 'center',
                fontFamily: HF.display, fontWeight: 800, fontSize: 16, color: HF.ink2,
              }}>FH</div>
              <div style={{ flex: 1 }}>
                <P size={14} weight={700}>Frank Hawkins</P>
                <P size={11} color={HF.ink3}>PM · Juan Garcia · Building A</P>
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <Button variant="secondary" size="md" full>
                Send Frank a message
                <Icon name="arrow" size={14} color={HF.ink} style={{ marginLeft: 4 }} />
              </Button>
            </div>
          </div>
        </Surface>

        {/* Up next */}
        <Surface>
          <div style={{ padding: '14px 16px' }}>
            <Eyebrow color={HF.ink3}>Up next</Eyebrow>
            <P size={13} weight={600} style={{ marginTop: 6 }}>Lease signing via DocuSign</P>
            <P size={11} color={HF.ink3} style={{ marginTop: 2 }}>
              Triggered after PM approval. Requested move-in: Jul 15, 2026.
            </P>
          </div>
        </Surface>
      </div>

      <BottomTabs active="home" />
    </MobileFrame>
  );
}

// ── 2.4 Documents feed (mobile) ──────────────────────────────────────
function V2DocumentsFeed() {
  const docs = [
    { icon: '🪪', name: 'Driver\'s License / State ID', sub: '2 files · front + back', status: 'verified' },
    { icon: '🔢', name: 'Social Security card',          sub: '1 file',                 status: 'verified' },
    { icon: '💰', name: 'Proof of income',                sub: '4 files · 3 paystubs + tax', status: 'verified' },
    { icon: '🏢', name: 'Proof of employment',            sub: 'Employer letter',         status: 'verified' },
    { icon: '🏦', name: 'Proof of assets',                sub: '2 bank statements',       status: 'verified' },
  ];
  return (
    <MobileFrame label="Documents · all verified" h={1500}>
      <DashHeader greeting="Documents" subtitle="All 5 docs Frank reviewed" backable />

      <div style={{ padding: '12px 20px 100px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Verified summary */}
        <Surface raised style={{ background: HF.okLo, borderColor: '#CFE1CB' }}>
          <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <Icon name="check" size={28} color={HF.ok} />
            <div style={{ flex: 1 }}>
              <P size={13} weight={700} color={HF.ok}>5 / 5 verified by Frank</P>
              <P size={11} color={HF.ink3}>Max 120 days old — next re-verify at annual recert</P>
            </div>
          </div>
        </Surface>

        {/* Doc list */}
        {docs.map((d, i) => (
          <Surface key={i} data-uh-routed="true"
            onClick={() => window.__UH_GO_TO__ && window.__UH_GO_TO__('inbox')}>
            <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
              <span style={{ fontSize: 24, flex: '0 0 30px', textAlign: 'center' }}>{d.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <P size={13} weight={600} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {d.name}
                </P>
                <P size={11} color={HF.ink3}>Uploaded May 14 · {d.sub}</P>
              </div>
              <Tag tone="ok">
                <Icon name="check" size={10} color={HF.ok} style={{ marginRight: 2 }} />
                Verified
              </Tag>
            </div>
          </Surface>
        ))}

        <Surface>
          <div style={{ padding: '10px 12px' }}>
            <P size={11} color={HF.ink3}>
              ⏱ Documents re-verified every 365 days at recertification.
            </P>
          </div>
        </Surface>
      </div>

      <BottomTabs active="docs" />
    </MobileFrame>
  );
}

// ── 2.5 Inbox / Messages (mobile) ────────────────────────────────────
function V2Inbox() {
  const threads = [
    {
      from: 'Frank Hawkins · PM',
      preview: 'Hi Marisol — great news. Your application moved to position #12 this week. A 2BR opened up at Fletcher if you want to check it out. Otherwise we keep climbing.',
      time: '2 days ago',
      unread: true,
      avatar: 'FH', color: HF.accent,
      target: 'wl-dash',
      cta: { label: 'View the 2BR at Fletcher →', target: 'detail' },
    },
    {
      from: 'Universal Housing · Notice',
      preview: '⚠️ Rent is past due. A 7-day Pay-or-Quit notice has been posted to your file (NRS 40.253). Pay $1,034.00 by Aug 13 to cure.',
      time: '3 days ago',
      unread: true,
      avatar: 'UH', color: HF.warn || '#B45309', official: true,
      target: 'late-paq',
    },
    {
      from: 'Universal Housing',
      preview: '✨ You moved up 3 spots! You\'re now #12 of 38 on the 2BR list at Juan Garcia.',
      time: '5 days ago',
      unread: false,
      avatar: 'UH', color: HF.sage, official: true,
      target: 'wl-dash',
    },
    {
      from: 'Universal Housing · Notice',
      preview: '📋 Annual recertification packet ready · auto-prepared from your application',
      time: '1 wk ago',
      unread: false,
      avatar: 'UH', color: HF.ink2, official: true,
      target: 'recert',
    },
    {
      from: 'Frank Hawkins · PM',
      preview: 'All 5 documents verified ✓. Your file is officially in PM review queue.',
      time: '2 wk ago',
      unread: false,
      avatar: 'FH', color: HF.accent,
      target: 'docs',
    },
    {
      from: 'Universal Housing',
      preview: 'Welcome to Universal Housing, Marisol. Here\'s how to make the most of your application during the wait.',
      time: '4 wk ago',
      unread: false,
      avatar: 'UH', color: HF.sage, official: true,
      target: 'wl-dash',
    },
  ];

  return (
    <MobileFrame label="Inbox · 2 unread" h={1700}>
      <DashHeader greeting="Inbox" subtitle="2 unread messages" backable />

      <div style={{ padding: '6px 0 100px' }}>
        {threads.map((t, i) => (
          <span
            key={i}
            data-uh-routed="true"
            onClick={() => t.target && window.__UH_GO_TO__ && window.__UH_GO_TO__(t.target)}
            style={{ display: 'block' }}
          >
            <div style={{
              display: 'flex', gap: 12, padding: '14px 20px',
              borderBottom: `1px solid ${HF.border}`,
              background: t.unread ? HF.accentLo : HF.paper,
              cursor: 'pointer',
            }}>
              <div style={{
                width: 44, height: 44, flex: '0 0 44px', borderRadius: HF.r.pill,
                background: t.color, color: HF.paper,
                display: 'grid', placeItems: 'center',
                fontFamily: HF.display, fontWeight: 800, fontSize: 14,
              }}>{t.avatar}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                  <P size={13} weight={t.unread ? 800 : 600} style={{
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{t.from}</P>
                  <P size={10} color={HF.ink3} style={{ flex: '0 0 auto' }}>{t.time}</P>
                </div>
                <P size={12} color={t.unread ? HF.ink : HF.ink3} style={{
                  marginTop: 2, lineHeight: 1.4,
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}>{t.preview}</P>
                {t.cta && (
                  <span
                    data-uh-routed="true"
                    onClick={(e) => {
                      e.stopPropagation();
                      window.__UH_GO_TO__ && window.__UH_GO_TO__(t.cta.target);
                    }}
                    style={{
                      display: 'inline-block', marginTop: 8,
                      padding: '5px 10px', borderRadius: HF.r.sm,
                      background: HF.accent, color: HF.paper,
                      fontFamily: HF.body, fontWeight: 700, fontSize: 11,
                      cursor: 'pointer',
                    }}
                  >{t.cta.label}</span>
                )}
                {t.unread && !t.cta && (
                  <div style={{ marginTop: 4 }}>
                    <span style={{
                      display: 'inline-block', width: 8, height: 8, borderRadius: HF.r.pill,
                      background: HF.accent,
                    }} />
                  </div>
                )}
              </div>
            </div>
          </span>
        ))}
      </div>

      <BottomTabs active="inbox" />
    </MobileFrame>
  );
}

// ── Shared dashboard header + bottom tabs ────────────────────────────
function DashHeader({ greeting, subtitle, backable }) {
  return (
    <div style={{
      padding: '8px 20px 14px', background: HF.paper, borderBottom: `1px solid ${HF.border}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {backable && (
          <button style={{
            width: 36, height: 36, borderRadius: HF.r.pill, background: HF.cream,
            border: `1px solid ${HF.border}`, cursor: 'pointer',
            display: 'grid', placeItems: 'center',
          }}>
            <Icon name="arrowLeft" size={16} color={HF.ink} />
          </button>
        )}
        <div style={{ flex: 1 }}>
          <H3 style={{ fontSize: 18 }}>{greeting}</H3>
          <P size={11} color={HF.ink3}>{subtitle}</P>
        </div>
        <div style={{
          width: 36, height: 36, borderRadius: HF.r.pill, background: HF.cream,
          border: `1px solid ${HF.border}`, display: 'grid', placeItems: 'center',
          fontFamily: HF.display, fontWeight: 800, fontSize: 12, color: HF.ink,
        }}>M</div>
      </div>
    </div>
  );
}

function BottomTabs({ active = 'home' }) {
  const tabs = [
    { id: 'home',  icon: 'home',   l: 'Home' },
    { id: 'docs',  icon: 'check',  l: 'Docs' },
    { id: 'inbox', icon: 'bell',   l: 'Inbox' },
    { id: 'me',    icon: 'star',   l: 'Account' },
  ];
  return (
    <div style={{
      position: 'absolute', left: 0, right: 0, bottom: 0,
      background: HF.paper, borderTop: `1px solid ${HF.border}`,
      padding: '10px 20px 26px',
      display: 'flex', justifyContent: 'space-around',
    }}>
      {tabs.map((t, i) => (
        <div key={i} style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
        }}>
          <Icon name={t.icon} size={20} color={t.id === active ? HF.accent : HF.ink3} />
          <span style={{
            fontFamily: HF.body, fontSize: 10,
            fontWeight: t.id === active ? 700 : 500,
            color: t.id === active ? HF.accent : HF.ink3,
          }}>{t.l}</span>
        </div>
      ))}
    </div>
  );
}

Object.assign(window, {
  V2WaitlistDashboard, V2ProcessingDashboard, V2DocumentsFeed, V2Inbox,
  PropertyAnchorStrip, DashHeader, BottomTabs,
});
