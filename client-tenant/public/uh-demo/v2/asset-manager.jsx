// V2 · Asset Manager portal — the portfolio-wide tool above PMs.
// Three desktop screens:
//   7.1 Portfolio dashboard · all 16 communities at a glance
//   7.2 Audit pack compiler · one-click federal/state/investor/CPA/county/city
//   7.3 HUD auto-update engine · incoming changes + lease amendment queue
//
// Stays warm/friendly (same tokens as tenant app) but information-denser.

function AMShell({ active = 'portfolio', children }) {
  const items = [
    { id: 'portfolio', l: 'Portfolio' },
    { id: 'audits',    l: 'Audit packs' },
    { id: 'hud',       l: 'HUD updates' },
    { id: 'compliance',l: 'Compliance' },
    { id: 'reports',   l: 'Reports' },
  ];
  return (
    <div style={{ minHeight: '100vh', background: HF.cream, fontFamily: HF.body, color: HF.ink }}>
      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 24,
        padding: '14px 28px', background: HF.paper, borderBottom: `1px solid ${HF.border}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: HF.r.sm,
            background: HF.accent, color: HF.paper,
            display: 'grid', placeItems: 'center',
            fontFamily: HF.display, fontWeight: 800, fontSize: 15,
          }}>U</div>
          <div style={{ fontFamily: HF.display, fontWeight: 700, fontSize: 16, letterSpacing: '-0.01em' }}>
            Universal Housing
            <span style={{ color: HF.ink3, fontWeight: 500, marginLeft: 8 }}>· Asset Manager</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, marginLeft: 16 }}>
          {items.map(item => (
            <a key={item.id} style={{
              padding: '8px 12px', borderRadius: HF.r.sm,
              fontFamily: HF.body, fontSize: 14, fontWeight: 500,
              color: item.id === active ? HF.ink : HF.ink3,
              background: item.id === active ? HF.cream : 'transparent',
              cursor: 'pointer',
            }}>{item.l}</a>
          ))}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontFamily: HF.body, fontSize: 12, color: HF.ink3 }}>
            Latonya R. · Asset Manager
          </span>
          <div style={{
            width: 36, height: 36, borderRadius: HF.r.pill, background: HF.cream,
            border: `1px solid ${HF.border}`, display: 'grid', placeItems: 'center',
            fontFamily: HF.display, fontWeight: 700, fontSize: 13,
          }}>LR</div>
        </div>
      </div>
      {children}
    </div>
  );
}

// Mini stat card
function Stat({ l, v, sub, tone = 'neutral' }) {
  const tones = {
    neutral: { c: HF.ink, bg: HF.paper },
    ok:      { c: HF.ok, bg: HF.okLo },
    warn:    { c: HF.warn, bg: HF.warnLo },
    accent:  { c: HF.accent, bg: HF.accentLo },
  };
  const t = tones[tone];
  return (
    <Surface style={{ background: t.bg, borderColor: tone === 'neutral' ? HF.border : t.c.replace(/.{2}$/,'33') }}>
      <div style={{ padding: '14px 16px' }}>
        <Eyebrow color={HF.ink3}>{l}</Eyebrow>
        <H1 style={{ fontSize: 32, marginTop: 4, color: t.c, letterSpacing: '-0.02em' }}>{v}</H1>
        {sub && <P size={11} color={HF.ink3} style={{ marginTop: 2 }}>{sub}</P>}
      </div>
    </Surface>
  );
}

// ── 7.1 Portfolio Dashboard ──────────────────────────────────────────
function V2AMPortfolio() {
  const totalUnits = PROPS.reduce((s, p) => s + p.units, 0);
  const totalVacancy = PROPS.reduce((s, p) => s + p.vacancy, 0);
  const occupancy = (((totalUnits - totalVacancy) / totalUnits) * 100).toFixed(1);
  return (
    <AMShell active="portfolio">
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '24px 28px 60px' }}>
        {/* Title */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div>
            <Eyebrow>Portfolio · May 15, 2026</Eyebrow>
            <H1 style={{ fontSize: 32, marginTop: 4 }}>16 communities · {totalUnits.toLocaleString()} units</H1>
            <P size={13} color={HF.ink2} style={{ marginTop: 4 }}>
              Live snapshot across Clark County · refreshed 2 min ago
            </P>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="secondary" size="md">Export CSV</Button>
            <Button variant="primary" size="md">+ Add property</Button>
          </div>
        </div>

        <div style={{ height: 20 }} />

        {/* KPI strip */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14 }}>
          <Stat l="Occupancy" v={occupancy + '%'} sub={`${totalUnits - totalVacancy} / ${totalUnits} units`} tone="ok" />
          <Stat l="Vacant now" v={totalVacancy} sub={`across ${PROPS.filter(p => p.vacancy > 0).length} properties`} tone="accent" />
          <Stat l="Waitlist (total)" v="847" sub="6-mo purge due Aug 1" />
          <Stat l="Recerts due 90d" v="38" sub="120/90/60 cascade active" tone="warn" />
          <Stat l="Open evictions" v="2" sub="1 pre-court · 1 7-day served" tone="warn" />
        </div>

        <div style={{ height: 20 }} />

        {/* Two column: properties table + alerts */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 20 }}>
          {/* Properties table */}
          <Surface raised>
            <div style={{
              padding: '14px 18px', borderBottom: `1px solid ${HF.border}`,
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <H3 style={{ flex: 1 }}>All 16 communities</H3>
              <Chip>Available now (8)</Chip>
              <Chip>Senior</Chip>
              <Chip>Family</Chip>
              <span style={{ marginLeft: 'auto', fontFamily: HF.body, fontSize: 11, color: HF.ink3 }}>
                sort: occupancy ▾
              </span>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: HF.cream, borderBottom: `1px solid ${HF.border}` }}>
                  {['Property', 'Type', 'Units', 'Vac', 'Waitlist', 'Status', 'Next action'].map(h => (
                    <th key={h} style={{
                      padding: '10px 12px', textAlign: 'left',
                      fontFamily: HF.body, fontSize: 11, fontWeight: 700, color: HF.ink3,
                      textTransform: 'uppercase', letterSpacing: '0.05em',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PROPS.slice(0, 10).map((p, i) => {
                  const status = p.vacancy > 0 ? 'ok' : p.waitlistMo > 4 ? 'warn' : 'neutral';
                  const action = p.vacancy > 0 ? 'Fill vacancy' : p.waitlistMo > 4 ? 'Purge waitlist' : 'On track';
                  return (
                    <tr key={i} style={{ borderBottom: `1px solid ${HF.border}` }}>
                      <td style={{ padding: '10px 12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{
                            width: 32, height: 32, borderRadius: HF.r.sm,
                            background: `#c4b496 url(${p.photo}) center/cover`,
                            flex: '0 0 32px',
                          }} />
                          <div>
                            <P size={12} weight={700} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>
                              {p.name.replace(' Apartments','').replace(' Community','').replace(' Housing','')}
                            </P>
                            <P size={10} color={HF.ink3}>{p.neighborhood}</P>
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <Tag tone={p.type === 'Veteran' ? 'accent' : p.type.startsWith('Senior') ? 'sage' : 'neutral'}>
                          {p.type}
                        </Tag>
                      </td>
                      <td style={{ padding: '10px 12px', fontFamily: HF.display, fontWeight: 700 }}>{p.units}</td>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{
                          fontFamily: HF.display, fontWeight: 800, fontSize: 14,
                          color: p.vacancy > 0 ? HF.ok : HF.ink3,
                        }}>{p.vacancy}</span>
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{
                          fontFamily: HF.body, fontSize: 12, fontWeight: 600,
                          color: p.waitlistMo > 4 ? HF.warn : HF.ink2,
                        }}>{p.waitlistMo}mo</span>
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <Tag tone={status}>
                          ● {p.vacancy > 0 ? 'Active' : p.waitlistMo > 4 ? 'Backed up' : 'On track'}
                        </Tag>
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <button style={{
                          background: 'transparent', border: 'none', cursor: 'pointer',
                          fontFamily: HF.body, fontSize: 12, fontWeight: 700, color: HF.accent,
                        }}>{action} →</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{
              padding: '10px 18px', borderTop: `1px solid ${HF.border}`,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: HF.cream,
            }}>
              <P size={11} color={HF.ink3}>Showing 10 of 16</P>
              <button style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                fontFamily: HF.body, fontSize: 11, fontWeight: 700, color: HF.accent,
              }}>See all 16 →</button>
            </div>
          </Surface>

          {/* Alerts column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Surface raised style={{ borderColor: HF.err }}>
              <div style={{ padding: '14px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Icon name="warning" size={16} color={HF.err} />
                  <Eyebrow color={HF.err}>Action required</Eyebrow>
                </div>
                <H3 style={{ fontSize: 14, marginTop: 6 }}>2 evictions need review</H3>
                <P size={11} color={HF.ink3} style={{ marginTop: 4 }}>
                  Harry Reid · Unit 412 served 7-day Aug 7 · expires today<br />
                  Hoggard · Unit 88 4+ late = material breach
                </P>
                <div style={{ marginTop: 8 }}>
                  <Button variant="primary" size="sm">Review queue</Button>
                </div>
              </div>
            </Surface>

            <Surface style={{ background: HF.sageLo, borderColor: '#D2DDC9' }}>
              <div style={{ padding: '14px 16px' }}>
                <Eyebrow color={HF.sage}>● Live</Eyebrow>
                <H3 style={{ fontSize: 14, marginTop: 6 }}>4 new applications today</H3>
                <P size={11} color={HF.ink3} style={{ marginTop: 4 }}>
                  1 govt referral · 3 standard FIFO · all docs uploaded
                </P>
              </div>
            </Surface>

            <Surface>
              <div style={{ padding: '14px 16px' }}>
                <Eyebrow color={HF.accent}>HUD update detected</Eyebrow>
                <H3 style={{ fontSize: 14, marginTop: 6 }}>2026 income limits published</H3>
                <P size={11} color={HF.ink3} style={{ marginTop: 4 }}>
                  Affects 16 properties · ~340 tenants · auto-amendments queued
                </P>
                <div style={{ marginTop: 8 }}>
                  <Button variant="secondary" size="sm">Review changes</Button>
                </div>
              </div>
            </Surface>

            <Surface>
              <div style={{ padding: '14px 16px' }}>
                <Eyebrow color={HF.ink3}>Audit windows</Eyebrow>
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[
                    { l: 'NV Housing Div · Q2', due: 'in 12 days', tone: 'warn' },
                    { l: 'Novogradac investor', due: 'in 38 days' },
                    { l: 'Workers comp · annual', due: 'in 51 days' },
                    { l: 'IRS Form 8609-A · 2026', due: 'in 78 days' },
                  ].map((row, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                      <P size={12}>{row.l}</P>
                      <P size={11} color={row.tone === 'warn' ? HF.warn : HF.ink3} weight={600}>{row.due}</P>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 10 }}>
                  <Button variant="ghost" size="sm" full>Open audit calendar →</Button>
                </div>
              </div>
            </Surface>
          </div>
        </div>
      </div>
    </AMShell>
  );
}

// ── 7.2 Audit Pack Compiler ──────────────────────────────────────────
function V2AMAudit() {
  return (
    <AMShell active="audits">
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '24px 28px 60px' }}>
        <div>
          <Eyebrow>Audit pack compiler</Eyebrow>
          <H1 style={{ fontSize: 32, marginTop: 4 }}>One-click audit packs</H1>
          <P size={14} color={HF.ink2} style={{ marginTop: 6, maxWidth: 720 }}>
            Each pack is auto-assembled from live system data. Federal, state, investor,
            CPA, county, city — pick a pack, pick a property (or all 16), generate PDF.
          </P>
        </div>

        <div style={{ height: 20 }} />

        {/* Active compile */}
        <Surface raised style={{ background: HF.accent, color: HF.paper, border: 'none' }}>
          <div style={{ padding: '20px 22px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
              <div style={{
                width: 56, height: 56, borderRadius: HF.r.md, background: HF.paper,
                display: 'grid', placeItems: 'center', flex: '0 0 56px',
              }}>
                <span style={{ fontSize: 28 }}>📦</span>
              </div>
              <div style={{ flex: 1 }}>
                <Eyebrow color="rgba(255,255,255,0.85)">Currently compiling</Eyebrow>
                <H2 style={{ fontSize: 22, color: HF.paper, marginTop: 4 }}>
                  NV Housing Division · Q2 2026
                </H2>
                <P size={12} color="rgba(255,255,255,0.85)" style={{ marginTop: 6 }}>
                  All 16 properties · 8 sections · ~340 tenant files · 12 / 12 days until due
                </P>
                <div style={{
                  marginTop: 12, height: 8, background: 'rgba(255,255,255,0.25)',
                  borderRadius: 99, overflow: 'hidden',
                }}>
                  <div style={{ width: '72%', height: '100%', background: HF.paper }} />
                </div>
                <P size={11} color="rgba(255,255,255,0.85)" style={{ marginTop: 6 }}>
                  72% · est. 3 min remaining · TIC files in progress
                </P>
              </div>
              <Button variant="secondary" size="md" style={{ background: HF.paper, color: HF.accent, border: 'none' }}>
                Open progress
              </Button>
            </div>
          </div>
        </Surface>

        <div style={{ height: 20 }} />

        {/* Pack types grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
          {[
            {
              icon: '🏛', title: 'Federal · IRS / HUD',
              sub: 'Form 8609, 8609-A, 8586 · TIC files · HUD-50059 · HQS records',
              status: 'Q2 ready', tone: 'ok', lastRun: 'May 1, 2026',
            },
            {
              icon: '🏢', title: 'State · NV Housing Div',
              sub: 'Q2 compliance report · 20% physical inspection · LIHTC training certs',
              status: 'compiling now', tone: 'accent', lastRun: 'Feb 1, 2026',
            },
            {
              icon: '💼', title: 'Investor · Novogradac',
              sub: 'Audited financials · rent rolls · K-1 schedules · reserves',
              status: 'in 38 days', tone: 'warn', lastRun: 'Apr 15, 2026',
            },
            {
              icon: '📊', title: 'CPA · Internal annual',
              sub: 'General ledger · AR/AP aging · fixed assets · depreciation',
              status: 'ready when needed', tone: 'neutral', lastRun: 'Jan 30, 2026',
            },
            {
              icon: '🏚', title: 'Workers comp · audit',
              sub: 'Insurance declarations · payroll · OSHA 300 · EMR',
              status: 'in 51 days', tone: 'neutral', lastRun: 'Jul 1, 2025',
            },
            {
              icon: '🗺', title: 'County / City',
              sub: 'Property tax · health inspections · business licenses · COs',
              status: 'on demand', tone: 'neutral', lastRun: 'Mar 10, 2026',
            },
          ].map((pack, i) => (
            <Surface key={i} raised={pack.tone === 'accent'}>
              <div style={{ padding: '16px 18px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: HF.r.md,
                    background: HF.cream, border: `1px solid ${HF.border}`,
                    display: 'grid', placeItems: 'center', flex: '0 0 44px',
                  }}>
                    <span style={{ fontSize: 22 }}>{pack.icon}</span>
                  </div>
                  <div style={{ flex: 1 }}>
                    <H3 style={{ fontSize: 15 }}>{pack.title}</H3>
                    <P size={11} color={HF.ink3} style={{ marginTop: 4, lineHeight: 1.4 }}>{pack.sub}</P>
                  </div>
                </div>
                <div style={{
                  marginTop: 14, paddingTop: 14, borderTop: `1px solid ${HF.border}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                  <Tag tone={pack.tone}>{pack.status}</Tag>
                  <span style={{ fontFamily: HF.body, fontSize: 10, color: HF.ink3 }}>
                    last: {pack.lastRun}
                  </span>
                </div>
                <div style={{ marginTop: 10 }}>
                  <Button variant="primary" size="sm" full>Generate pack</Button>
                </div>
              </div>
            </Surface>
          ))}
        </div>

        <div style={{ height: 20 }} />

        {/* Recent compiles */}
        <Surface>
          <div style={{ padding: '14px 18px', borderBottom: `1px solid ${HF.border}` }}>
            <H3>Recently generated</H3>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: HF.cream, borderBottom: `1px solid ${HF.border}` }}>
                {['Pack', 'Scope', 'Generated', 'Size', 'Status', ''].map(h => (
                  <th key={h} style={{
                    padding: '10px 14px', textAlign: 'left',
                    fontFamily: HF.body, fontSize: 11, fontWeight: 700, color: HF.ink3,
                    textTransform: 'uppercase', letterSpacing: '0.05em',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                ['Federal IRS 8609-A', '16 properties · 2025', 'Apr 14 2026 · 3:22 PM', '142 MB', 'Submitted', 'ok'],
                ['Novogradac Q1', '16 properties · Q1 2026', 'Apr 15 2026 · 9:10 AM', '88 MB', 'Submitted', 'ok'],
                ['Workers comp 2025', 'All entities', 'Mar 30 2026 · 1:45 PM', '24 MB', 'Submitted', 'ok'],
                ['Clark County tax', '16 properties · 2025', 'Mar 10 2026 · 11:20 AM', '12 MB', 'Submitted', 'ok'],
              ].map((row, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${HF.border}` }}>
                  <td style={{ padding: '10px 14px' }}><P size={12} weight={700}>{row[0]}</P></td>
                  <td style={{ padding: '10px 14px' }}><P size={11} color={HF.ink3}>{row[1]}</P></td>
                  <td style={{ padding: '10px 14px' }}><P size={11} color={HF.ink3}>{row[2]}</P></td>
                  <td style={{ padding: '10px 14px' }}><P size={11} color={HF.ink3} style={{ fontFamily: HF.mono }}>{row[3]}</P></td>
                  <td style={{ padding: '10px 14px' }}><Tag tone="ok">✓ {row[4]}</Tag></td>
                  <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                    <button style={{
                      background: 'transparent', border: 'none', cursor: 'pointer',
                      fontFamily: HF.body, fontSize: 11, fontWeight: 700, color: HF.accent,
                    }}>Download →</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Surface>
      </div>
    </AMShell>
  );
}

// ── 7.3 HUD Auto-Update Engine ───────────────────────────────────────
function V2AMHud() {
  return (
    <AMShell active="hud">
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '24px 28px 60px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div>
            <Eyebrow>HUD auto-update engine · monitoring active</Eyebrow>
            <H1 style={{ fontSize: 32, marginTop: 4 }}>2 changes pending propagation</H1>
            <P size={14} color={HF.ink2} style={{ marginTop: 6, maxWidth: 720 }}>
              Polled HUD User API, Federal Register, and NV Housing Division 2 min ago.
              Detected changes auto-route lease amendments and PM notifications.
            </P>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="ghost" size="md">Poll history</Button>
            <Button variant="secondary" size="md">Monitoring settings</Button>
          </div>
        </div>

        <div style={{ height: 20 }} />

        {/* Critical update banner */}
        <Surface raised style={{ borderColor: HF.accent, background: HF.accentLo }}>
          <div style={{ padding: '20px 22px', display: 'flex', alignItems: 'flex-start', gap: 16 }}>
            <div style={{
              width: 56, height: 56, borderRadius: HF.r.pill,
              background: HF.accent, color: HF.paper,
              display: 'grid', placeItems: 'center', flex: '0 0 56px',
              boxShadow: HF.shadow.sm,
            }}>
              <Icon name="bell" size={28} color={HF.paper} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Tag tone="accent">HUD · Critical · effective Jun 1</Tag>
                <span style={{ fontFamily: HF.body, fontSize: 11, color: HF.ink3 }}>
                  detected May 14 · 2:14 AM PST
                </span>
              </div>
              <H2 style={{ fontSize: 22, marginTop: 8 }}>
                2026 Clark County income limits published
              </H2>
              <P size={13} color={HF.ink2} style={{ marginTop: 6, lineHeight: 1.5 }}>
                HUD released new AMI limits at 30 / 50 / 60 / 80%. Affects rent caps,
                eligibility thresholds, and 17 active applications. PM amendments queued
                for all 16 properties · ~340 tenants · effective Jun 1.
              </P>
              <div style={{
                marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10,
              }}>
                {[
                  ['30% AMI', '$17,700 → $18,250'],
                  ['50% AMI', '$29,500 → $30,400'],
                  ['60% AMI', '$35,400 → $36,500'],
                  ['80% AMI', '$47,200 → $48,650'],
                ].map((row, i) => (
                  <div key={i} style={{
                    padding: '8px 10px', borderRadius: HF.r.sm,
                    background: HF.paper, border: `1px solid #F3D7CB`,
                  }}>
                    <Eyebrow color={HF.ink3}>{row[0]}</Eyebrow>
                    <P size={11} weight={700} style={{ marginTop: 2, fontFamily: HF.mono }}>{row[1]}</P>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
                <Button variant="primary" size="md">Review amendments (340)</Button>
                <Button variant="secondary" size="md">Open HUD source ↗</Button>
                <Button variant="ghost" size="md">Email PMs now</Button>
              </div>
            </div>
          </div>
        </Surface>

        <div style={{ height: 20 }} />

        {/* Standard updates feed + lease amendment queue */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 20 }}>
          <div>
            <H3 style={{ marginBottom: 10 }}>Update feed · last 30 days</H3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                {
                  type: 'Standard', source: 'HUD 4350.3 CHG-5', date: 'May 14, 2026',
                  title: 'TRACS form HUD-50059 updated · v3.2',
                  body: 'New version supersedes v3.1 in DocuSign templates. Auto-updated.',
                  status: 'Propagated', tone: 'ok',
                },
                {
                  type: 'Critical', source: 'HUD User API', date: 'May 14, 2026',
                  title: '2026 Clark County income limits',
                  body: 'New limits at 30/50/60/80% AMI. 340 tenants need amendments. Queued.',
                  status: 'Pending review', tone: 'accent',
                },
                {
                  type: 'Standard', source: 'NV Housing Div', date: 'May 8, 2026',
                  title: 'Updated 20% physical inspection procedure',
                  body: 'Compliance team notified. Inspection app updated.',
                  status: 'Propagated', tone: 'ok',
                },
                {
                  type: 'Informational', source: 'Federal Register', date: 'May 2, 2026',
                  title: 'VAWA reauthorization clarification',
                  body: 'Self-certification form (HUD-5382) text minor revision.',
                  status: 'Propagated', tone: 'ok',
                },
                {
                  type: 'Standard', source: 'HUD User API', date: 'Apr 22, 2026',
                  title: 'FY26 Fair Market Rents',
                  body: 'Section 8 voucher rent ceilings updated. Affects 4 voucher-receiving tenants.',
                  status: 'Propagated', tone: 'ok',
                },
              ].map((u, i) => (
                <Surface key={i}>
                  <div style={{ padding: '14px 16px', display: 'flex', gap: 12 }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: HF.r.pill, flex: '0 0 36px',
                      background: u.tone === 'accent' ? HF.accentLo : u.tone === 'ok' ? HF.okLo : HF.cream,
                      border: `1.5px solid ${u.tone === 'accent' ? HF.accent : u.tone === 'ok' ? HF.ok : HF.border}`,
                      display: 'grid', placeItems: 'center',
                      color: u.tone === 'accent' ? HF.accent : u.tone === 'ok' ? HF.ok : HF.ink2,
                    }}>
                      <Icon name={u.tone === 'ok' ? 'check' : u.tone === 'accent' ? 'warning' : 'bell'} size={16} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <Tag tone={u.tone === 'accent' ? 'accent' : u.tone === 'ok' ? 'ok' : 'neutral'}>{u.type}</Tag>
                        <P size={11} color={HF.ink3}>{u.source} · {u.date}</P>
                      </div>
                      <P size={13} weight={700} style={{ marginTop: 6 }}>{u.title}</P>
                      <P size={12} color={HF.ink2} style={{ marginTop: 2 }}>{u.body}</P>
                    </div>
                    <Tag tone={u.tone}>{u.status}</Tag>
                  </div>
                </Surface>
              ))}
            </div>
          </div>

          {/* Amendment queue */}
          <div>
            <H3 style={{ marginBottom: 10 }}>Lease amendment queue</H3>
            <Surface raised>
              <div style={{ padding: '14px 16px', borderBottom: `1px solid ${HF.border}` }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                  <P size={12} weight={700}>340 amendments pending</P>
                  <P size={11} color={HF.ink3}>16 properties</P>
                </div>
                <div style={{ height: 8, marginTop: 8, background: HF.cream, borderRadius: 99, overflow: 'hidden' }}>
                  <div style={{ width: '0%', height: '100%', background: HF.accent }} />
                </div>
                <P size={11} color={HF.ink3} style={{ marginTop: 4 }}>
                  0 sent · 340 ready · effective Jun 1
                </P>
              </div>
              <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  ['Senator Richard Bryan', 120, 0],
                  ['Senator Harry Reid', 100, 0],
                  ['Louise Shell', 100, 0],
                  ['Hoggard', 100, 0],
                  ['Sarann Knight', 82, 0],
                  ['Smith Williams', 80, 0],
                  ['Owens', 72, 0],
                ].map((row, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '6px 0', borderBottom: i === 6 ? 'none' : `1px dotted ${HF.border}`,
                  }}>
                    <P size={12}>{row[0]}</P>
                    <P size={11} color={HF.ink3}>
                      <span style={{ fontFamily: HF.mono, color: HF.accent, fontWeight: 700 }}>{row[1]}</span> queued
                    </P>
                  </div>
                ))}
                <P size={11} color={HF.ink3} style={{ marginTop: 4 }}>+ 9 more properties</P>
              </div>
              <div style={{ padding: '12px 16px', borderTop: `1px solid ${HF.border}`, background: HF.cream }}>
                <Button variant="primary" size="md" full>
                  Send all to DocuSign
                  <Icon name="arrow" size={14} color={HF.paper} style={{ marginLeft: 4 }} />
                </Button>
                <P size={10} color={HF.ink3} style={{ textAlign: 'center', marginTop: 6 }}>
                  PMs auto-notified · tenants receive in-app + email + SMS
                </P>
              </div>
            </Surface>

            <div style={{ height: 14 }} />
            <Surface style={{ background: HF.sageLo, borderColor: '#D2DDC9' }}>
              <div style={{ padding: '14px 16px' }}>
                <Eyebrow color={HF.sage}>Notifications going out</Eyebrow>
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {[
                    'All 16 Property Managers',
                    '4 Senior Managers',
                    '1 Asset Manager (you)',
                    'Maintenance Manager',
                  ].map((line, i) => (
                    <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <Icon name="check" size={12} color={HF.sage} />
                      <P size={11} color={HF.ink2}>{line}</P>
                    </div>
                  ))}
                </div>
              </div>
            </Surface>
          </div>
        </div>
      </div>
    </AMShell>
  );
}

Object.assign(window, { V2AMPortfolio, V2AMAudit, V2AMHud });
