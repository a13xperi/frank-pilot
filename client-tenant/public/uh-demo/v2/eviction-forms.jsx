// V2 · Phase 9E — PM Eviction Forms Library (G4.7).
// Cross-over from PM portal territory but included because:
//   - Same warm tenant tokens (consistency)
//   - Most legally-distinctive feature
//   - Frank runs evictions today and this is his world
//
// Per G4.7: all 13 landlord-served NV notices + 6 summary eviction filings
// + 5 formal eviction forms. Context-sensitive. Jurisdiction-aware. LIHTC
// good-cause filter. One-tap generation with auto-fill.

function V2EvictionForms() {
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
            <span style={{ color: HF.ink3, fontWeight: 500, marginLeft: 8 }}>· PM portal</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, marginLeft: 16 }}>
          {['Home', 'Applications', 'Tenants', 'Compliance', 'Eviction Forms'].map((l, i) => (
            <a key={i} style={{
              padding: '8px 12px', borderRadius: HF.r.sm,
              fontFamily: HF.body, fontSize: 14, fontWeight: 500,
              color: l === 'Eviction Forms' ? HF.ink : HF.ink3,
              background: l === 'Eviction Forms' ? HF.cream : 'transparent',
              cursor: 'pointer',
            }}>{l}</a>
          ))}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontFamily: HF.body, fontSize: 12, color: HF.ink3 }}>Frank Hawkins · PM</span>
          <div style={{
            width: 36, height: 36, borderRadius: HF.r.pill, background: HF.cream,
            border: `1px solid ${HF.border}`, display: 'grid', placeItems: 'center',
            fontFamily: HF.display, fontWeight: 700, fontSize: 13,
          }}>FH</div>
        </div>
      </div>

      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '24px 28px 60px' }}>
        {/* Title + context picker */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
          <div>
            <Eyebrow>PM Portal · Eviction & Compliance</Eyebrow>
            <H1 style={{ fontSize: 32, marginTop: 4 }}>Eviction Forms Library</H1>
            <P size={14} color={HF.ink2} style={{ marginTop: 6, maxWidth: 760 }}>
              All NV Regional Justice Center court-approved notices in one panel. Pick a
              tenant + violation type → we auto-fill, route to the right Constable, and
              block "no-cause" notices during LIHTC compliance.
            </P>
          </div>
          <Button variant="secondary" size="md">Quarterly form refresh</Button>
        </div>

        {/* Active context strip */}
        <Surface raised style={{ marginTop: 18, background: HF.accent, color: HF.paper, border: 'none' }}>
          <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <Eyebrow color="rgba(255,255,255,0.85)">Active case</Eyebrow>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 40, height: 40, borderRadius: HF.r.pill, background: HF.paper, color: HF.accent,
                display: 'grid', placeItems: 'center', fontFamily: HF.display, fontWeight: 800, fontSize: 14,
              }}>JT</div>
              <div>
                <P size={13} weight={700} color={HF.paper}>James Trotter · Hoggard · Unit 88</P>
                <P size={11} color="rgba(255,255,255,0.85)">Nonpayment · 9 days late · 4th late in 12mo · Aug 15, 2026</P>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', alignItems: 'center' }}>
              <Tag tone="warn" style={{ background: HF.paper, color: HF.warn, border: 'none' }}>Material breach</Tag>
              <Tag tone="neutral" style={{ background: HF.paper, color: HF.ink, border: 'none' }}>
                📍 Las Vegas Justice Court
              </Tag>
              <Tag tone="sage" style={{ background: HF.paper, color: HF.sage, border: 'none' }}>
                LIHTC compliance period active
              </Tag>
            </div>
          </div>
        </Surface>

        {/* AI-suggested form */}
        <Surface raised style={{ marginTop: 14, borderColor: HF.sage }}>
          <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 44, height: 44, borderRadius: HF.r.pill, background: HF.sage, color: HF.paper,
              display: 'grid', placeItems: 'center', flex: '0 0 44px',
            }}><Icon name="spark" size={20} color={HF.paper} /></div>
            <div style={{ flex: 1 }}>
              <Eyebrow color={HF.sage}>Recommended notice</Eyebrow>
              <H3 style={{ fontSize: 17, marginTop: 4 }}>
                7-Day Notice to Pay Rent or Quit (NRS 40.253)
              </H3>
              <P size={12} color={HF.ink3} style={{ marginTop: 4, lineHeight: 1.4 }}>
                Standard nonpayment + material breach (4+ late). Auto-fills tenant + property + $1,034 owed.
                Constable Instructions auto-set to Las Vegas jurisdiction.
              </P>
            </div>
            <Button variant="primary" size="md">
              Generate + serve
              <Icon name="arrow" size={14} color={HF.paper} style={{ marginLeft: 4 }} />
            </Button>
          </div>
        </Surface>

        <div style={{ height: 24 }} />

        {/* Three columns: Landlord notices · Summary filings · Formal eviction */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr', gap: 18 }}>
          {/* ── Landlord-served notices ── */}
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
              <H3>Landlord-served notices · 13</H3>
              <P size={11} color={HF.ink3}>NRS 40.253 + others</P>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[
                { l: '7-Day Notice to Pay Rent or Quit', sub: 'NRS 40.253 · nonpayment · standard', tone: 'recommended', context: 'matches active case' },
                { l: '5-Day Notice to Perform Lease Condition or Quit', sub: 'Lease violation other than rent', tone: 'available' },
                { l: '3-Day Notice to Quit · Nuisance / Drugs / Subletting', sub: 'Material breach · expedited', tone: 'available' },
                { l: '30-Day Nonpayment Notice · CARES Act', sub: 'Federally-backed mortgage properties only', tone: 'na', reason: 'Hoggard is not CARES-flagged' },
                { l: '7-Day "No Cause" Notice to Quit', sub: 'Week-to-week termination', tone: 'blocked', reason: 'LIHTC requires good cause' },
                { l: '30-Day "No Cause" Notice to Quit', sub: 'Month-to-month termination', tone: 'blocked', reason: 'LIHTC requires good cause' },
                { l: '5-Day Notice to Quit · Tenancy-at-Will', sub: 'No written lease · holdover', tone: 'na', reason: 'lease on file' },
                { l: '5-Day Notice to Quit · Unlawful Detainer', sub: 'Holdover after notice expired', tone: 'available' },
                { l: '5-Day Notice to Pay or Quit (Commercial)', sub: 'Commercial properties only', tone: 'na', reason: 'residential only' },
                { l: '3-Day Notice to Quit Following Sale', sub: 'Post-foreclosure holdover', tone: 'na' },
                { l: 'Notice of Change of Ownership · Foreclosure', sub: 'NRS 40.255', tone: 'available' },
                { l: 'Notice of Change of Ownership · Transfer/Sale', sub: 'NRS 40.255', tone: 'available' },
                { l: 'Certificate of Mailing', sub: 'Service proof · auto-attached to every notice', tone: 'auto' },
              ].map((f, i) => (
                <Surface key={i} style={{
                  borderColor: f.tone === 'recommended' ? HF.sage
                    : f.tone === 'blocked' ? HF.err
                    : f.tone === 'na' ? HF.border : HF.border,
                  background: f.tone === 'recommended' ? HF.sageLo
                    : f.tone === 'blocked' ? HF.errLo
                    : f.tone === 'na' ? HF.cream : HF.paper,
                  opacity: f.tone === 'na' ? 0.55 : 1,
                }}>
                  <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: HF.r.sm, flex: '0 0 28px',
                      background: HF.paper,
                      border: `1.5px solid ${
                        f.tone === 'recommended' ? HF.sage
                        : f.tone === 'blocked' ? HF.err
                        : f.tone === 'auto' ? HF.accent
                        : HF.border
                      }`,
                      display: 'grid', placeItems: 'center',
                      color: f.tone === 'recommended' ? HF.sage
                        : f.tone === 'blocked' ? HF.err
                        : f.tone === 'auto' ? HF.accent
                        : HF.ink3,
                    }}>
                      {f.tone === 'recommended' ? <Icon name="check" size={14} color={HF.sage} />
                        : f.tone === 'blocked' ? <Icon name="close" size={14} color={HF.err} />
                        : f.tone === 'auto' ? <span style={{ fontSize: 14 }}>📎</span>
                        : <span style={{ fontFamily: HF.body, fontSize: 11, fontWeight: 700 }}>{i + 1}</span>}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <P size={12} weight={700} style={{
                        textDecoration: f.tone === 'blocked' ? 'line-through' : 'none',
                        color: f.tone === 'blocked' ? HF.err : HF.ink,
                      }}>{f.l}</P>
                      <P size={10} color={HF.ink3}>{f.sub}</P>
                      {f.context && <P size={10} color={HF.sage} weight={700} style={{ marginTop: 2 }}>★ {f.context}</P>}
                      {f.reason && <P size={10} color={HF.err} style={{ marginTop: 2 }}>⊘ {f.reason}</P>}
                    </div>
                    {f.tone !== 'blocked' && f.tone !== 'na' && f.tone !== 'auto' && (
                      <button style={{
                        padding: '5px 10px', borderRadius: HF.r.sm, border: `1px solid ${HF.border}`,
                        background: HF.paper, cursor: 'pointer',
                        fontFamily: HF.body, fontWeight: 700, fontSize: 11,
                      }}>Open</button>
                    )}
                  </div>
                </Surface>
              ))}
            </div>
          </div>

          {/* ── Summary eviction filings (column 2) ── */}
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
              <H3>Summary eviction · 6</H3>
              <P size={11} color={HF.ink3}>After notice expires</P>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[
                { l: 'Complaint for Summary Eviction · Nonpayment', sub: 'Filed after 7-Day expires', next: true },
                { l: 'Complaint for Summary Eviction · Other', sub: 'After 5-Day Perform-or-Quit expires' },
                { l: 'Instructions to the Constable', sub: 'Auto-selects Las Vegas (matches property)' },
                { l: 'Motion to Rescind / Reissue / Dismiss', sub: 'Procedural correction' },
                { l: 'Motion for Exemption from Foreclosure Stay', sub: 'Special motion' },
                { l: 'Process Flowcharts (PDF reference)', sub: 'Nonpayment + Other paths', resource: true },
              ].map((f, i) => (
                <Surface key={i} style={{
                  borderColor: f.next ? HF.accent : HF.border,
                  background: f.next ? HF.accentLo : HF.paper,
                }}>
                  <div style={{ padding: '10px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {f.next && <Tag tone="accent">Next step</Tag>}
                      {f.resource && <Tag tone="neutral">Reference</Tag>}
                    </div>
                    <P size={12} weight={700} style={{ marginTop: f.next || f.resource ? 6 : 0 }}>{f.l}</P>
                    <P size={10} color={HF.ink3} style={{ marginTop: 2 }}>{f.sub}</P>
                  </div>
                </Surface>
              ))}
            </div>

            {/* Jurisdiction info */}
            <Surface style={{ marginTop: 12, background: HF.cream }}>
              <div style={{ padding: '12px 14px' }}>
                <Eyebrow color={HF.ink3}>Constable jurisdiction · auto-matched</Eyebrow>
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {[
                    { l: 'Las Vegas', n: 11, active: true },
                    { l: 'North Las Vegas', n: 3 },
                    { l: 'Henderson', n: 2 },
                  ].map((j, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <P size={11} color={j.active ? HF.accent : HF.ink2} weight={j.active ? 700 : 500}>
                        📍 {j.l} {j.active && '· this property'}
                      </P>
                      <P size={11} color={HF.ink3}>{j.n} properties</P>
                    </div>
                  ))}
                </div>
              </div>
            </Surface>
          </div>

          {/* ── Formal eviction (column 3) ── */}
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
              <H3>Formal eviction · 5</H3>
              <P size={11} color={HF.ink3}>Non-summary process</P>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[
                'Complaint for Unlawful Detainer (After Sale)',
                'Complaint for Unlawful Detainer (Not After Sale)',
                'Answer to Complaint for Unlawful Detainer',
                'Application/Order for Temporary Writ of Restitution',
                'Summons · Unlawful Detainer',
              ].map((l, i) => (
                <Surface key={i}>
                  <div style={{ padding: '10px 14px' }}>
                    <P size={12} weight={700}>{l}</P>
                    <P size={10} color={HF.ink3} style={{ marginTop: 2 }}>Pre-filled with tenant + property</P>
                  </div>
                </Surface>
              ))}
            </div>

            {/* Active case timeline */}
            <Surface raised style={{ marginTop: 14 }}>
              <div style={{ padding: '14px 16px' }}>
                <Eyebrow color={HF.accent}>James Trotter · timeline</Eyebrow>
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[
                    { d: 'Aug 6', l: 'Rent due', done: true },
                    { d: 'Aug 11', l: 'Grace period ends · late fees begin', done: true },
                    { d: 'Aug 15', l: '4th late payment (12-mo material breach)', done: true, accent: true },
                    { d: 'Today', l: 'Serve 7-Day Pay-or-Quit', current: true },
                    { d: 'Aug 22', l: 'Notice expires · file summary eviction', upcoming: true },
                    { d: 'Aug 29', l: 'Court hearing · Las Vegas Justice', upcoming: true },
                  ].map((s, i) => (
                    <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <div style={{
                        width: 22, height: 22, borderRadius: HF.r.pill, flex: '0 0 22px',
                        background: s.current ? HF.accent : s.done ? HF.border : HF.paper,
                        border: `1.5px solid ${s.current ? HF.accent : s.done ? HF.border : HF.ink3}`,
                        color: s.current ? HF.paper : HF.ink2,
                        display: 'grid', placeItems: 'center',
                        fontFamily: HF.display, fontWeight: 800, fontSize: 10,
                      }}>{s.done ? '✓' : s.current ? '▶' : ''}</div>
                      <div style={{ flex: 1 }}>
                        <P size={11} weight={s.current ? 700 : 600}
                           color={s.current ? HF.accent : s.accent ? HF.warn : HF.ink}>
                          {s.l}
                        </P>
                        <P size={10} color={HF.ink3}>{s.d}</P>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </Surface>
          </div>
        </div>

        {/* Footer · system status */}
        <div style={{
          marginTop: 24, padding: '14px 20px', borderRadius: HF.r.md,
          background: HF.paper, border: `1px solid ${HF.border}`,
          display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: 99, background: HF.ok }} />
            <P size={11} color={HF.ink2}>
              <b>Templates current.</b> Last refresh from civillawselfhelpcenter.org · Apr 12, 2026
            </P>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: 99, background: HF.ok }} />
            <P size={11} color={HF.ink2}>
              <b>VAWA pre-check</b> ran · no protected-class flag on this tenant
            </P>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: 99, background: HF.ok }} />
            <P size={11} color={HF.ink2}>
              <b>Offline cache</b> · all PDFs available without internet (K5.1)
            </P>
          </div>
          <button style={{
            marginLeft: 'auto', background: 'transparent', border: 'none', cursor: 'pointer',
            fontFamily: HF.body, fontSize: 12, fontWeight: 700, color: HF.accent,
          }}>Open source library on civillawselfhelpcenter.org ↗</button>
        </div>
      </div>
    </div>
  );
}

window.V2EvictionForms = V2EvictionForms;
