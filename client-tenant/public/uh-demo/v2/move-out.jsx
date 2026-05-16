// V2 · Move-out flow — when a tenant decides not to renew.
// 3 screens: declare intent (30-day notice) → checklist → walkthrough + deposit.

// ── 5.1 Move-out intent + 30-day notice ──────────────────────────────
function V2MoveOutIntent() {
  return (
    <MobileFrame label="Move-out · 30-day notice" h={2000}>
      <div style={{ padding: '10px 20px 14px', background: HF.paper, borderBottom: `1px solid ${HF.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button style={{
            width: 36, height: 36, borderRadius: HF.r.pill, background: HF.cream,
            border: `1px solid ${HF.border}`, cursor: 'pointer',
            display: 'grid', placeItems: 'center',
          }}><Icon name="arrowLeft" size={16} color={HF.ink} /></button>
          <H3 style={{ fontSize: 16, flex: 1 }}>Move-out notice</H3>
        </div>
      </div>

      <div style={{ padding: '20px 20px 100px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <H2 style={{ fontSize: 22 }}>We're sorry to see you go</H2>
          <P size={13} color={HF.ink3} style={{ marginTop: 4 }}>
            We'll walk you through it step by step to protect your deposit.
          </P>
        </div>

        <PropertyAnchor />

        {/* Notice period · primary */}
        <Surface raised style={{ background: HF.warnLo, borderColor: '#E8D6A8' }}>
          <div style={{ padding: '18px 20px' }}>
            <Eyebrow color={HF.warn}>Notice required by lease</Eyebrow>
            <H1 style={{ fontSize: 32, marginTop: 6, letterSpacing: '-0.02em' }}>
              30 days written notice
            </H1>
            <div style={{
              marginTop: 12, paddingTop: 12, borderTop: `1px dashed ${HF.warn}`,
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10,
            }}>
              <div>
                <Eyebrow color={HF.ink3}>Today</Eyebrow>
                <P size={14} weight={700} style={{ marginTop: 2 }}>May 15, 2027</P>
              </div>
              <div>
                <Eyebrow color={HF.ink3}>Earliest move-out</Eyebrow>
                <P size={14} weight={700} color={HF.accent} style={{ marginTop: 2 }}>Jun 14, 2027</P>
              </div>
            </div>
          </div>
        </Surface>

        {/* Reason (optional) */}
        <Surface>
          <div style={{ padding: '14px 16px' }}>
            <Eyebrow color={HF.ink3}>Why are you moving? (Optional)</Eyebrow>
            <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {[
                { l: 'Family / personal' },
                { l: 'Job', active: true },
                { l: 'Need more space' },
                { l: 'Bought a home' },
                { l: 'Other' },
              ].map((c, i) => (
                <Chip key={i} active={c.active}>{c.l}</Chip>
              ))}
            </div>
          </div>
        </Surface>

        {/* Date picker */}
        <Surface>
          <div style={{ padding: '14px 16px' }}>
            <Eyebrow color={HF.ink3}>Your move-out date</Eyebrow>
            <div style={{
              marginTop: 8, padding: '12px 14px', borderRadius: HF.r.md,
              border: `1.5px solid ${HF.ink}`, background: HF.paper,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span style={{ fontFamily: HF.display, fontWeight: 700, fontSize: 16 }}>Jun 30, 2027</span>
              <Icon name="map" size={16} color={HF.ink3} />
            </div>
            <P size={11} color={HF.ok} weight={700} style={{ marginTop: 6 }}>
              ✓ 46 days from today · satisfies 30-day notice
            </P>
          </div>
        </Surface>

        {/* Forwarding address */}
        <Surface>
          <div style={{ padding: '14px 16px' }}>
            <Eyebrow color={HF.ink3}>Forwarding address · required for deposit</Eyebrow>
            <div style={{
              marginTop: 8, padding: '0 14px', height: 44,
              borderRadius: HF.r.md, border: `1.5px solid ${HF.borderHi}`, background: HF.paper,
              display: 'flex', alignItems: 'center',
            }}>
              <span style={{ fontFamily: HF.body, fontSize: 13, color: HF.ink2 }}>
                4421 N Tonopah Dr, Las Vegas NV 89108
              </span>
            </div>
          </div>
        </Surface>

        {/* What happens next */}
        <Surface>
          <div style={{ padding: '14px 16px' }}>
            <Eyebrow color={HF.ink3}>After you submit</Eyebrow>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                'Frank confirms and opens your move-out checklist.',
                'You schedule a move-out walkthrough together.',
                'After the walkthrough, your deposit is paid within 21 days (NRS 118A.242).',
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

        <span data-uh-routed="true" onClick={() => window.__UH_GO_TO__ && window.__UH_GO_TO__('mo-checklist')}>
          <Button variant="primary" size="lg" full>
            Submit move-out notice
            <Icon name="arrow" size={16} color={HF.paper} style={{ marginLeft: 4 }} />
          </Button>
        </span>
      </div>

      <TenantNav active="home" />
    </MobileFrame>
  );
}

// ── 5.2 Move-out checklist ───────────────────────────────────────────
function V2MoveOutChecklist() {
  return (
    <MobileFrame label="Move-out · checklist · 24d left" h={2200}>
      <div style={{ padding: '10px 20px 14px', background: HF.paper, borderBottom: `1px solid ${HF.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button style={{
            width: 36, height: 36, borderRadius: HF.r.pill, background: HF.cream,
            border: `1px solid ${HF.border}`, cursor: 'pointer',
            display: 'grid', placeItems: 'center',
          }}><Icon name="arrowLeft" size={16} color={HF.ink} /></button>
          <H3 style={{ fontSize: 16, flex: 1 }}>Move-out checklist</H3>
        </div>
      </div>

      <div style={{ padding: '20px 20px 100px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <H2 style={{ fontSize: 22 }}>Your move-out plan</H2>
          <P size={13} color={HF.ink3} style={{ marginTop: 4 }}>
            Moving out Jun 30 · 24 days remaining
          </P>
        </div>

        <PropertyAnchor />

        {/* Progress */}
        <Surface raised style={{ background: HF.accentLo, borderColor: '#F3D7CB' }}>
          <div style={{ padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <Eyebrow color={HF.accent}>Progress</Eyebrow>
              <span style={{ fontFamily: HF.display, fontWeight: 800, fontSize: 22, color: HF.accent }}>3 / 7</span>
            </div>
            <div style={{ height: 8, marginTop: 10, background: '#FBE5DD', borderRadius: 99, overflow: 'hidden' }}>
              <div style={{ width: '43%', height: '100%', background: HF.accent }} />
            </div>
            <P size={11} color={HF.ink3} style={{ marginTop: 6 }}>
              43% complete · 4 tasks remaining
            </P>
          </div>
        </Surface>

        {/* On your side */}
        <div>
          <Eyebrow color={HF.ink3}>On your side</Eyebrow>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[
              { icon: '📝', l: '30-day notice submitted', sub: 'May 15, 2027', done: true },
              { icon: '📮', l: 'Forwarded mail with USPS', sub: 'Confirmed May 16', done: true },
              { icon: '⚡', l: 'Scheduled utility shutoff', sub: 'NV Energy + Southwest Gas · Jun 30', done: true },
              { icon: '📦', l: 'Pack everything out', sub: 'By 5pm Jun 30' },
              { icon: '🧹', l: 'Deep-clean the unit', sub: 'Or pay $250 cleaning fee · optional' },
              { icon: '🔑', l: 'Return keys to PM', sub: 'At the walkthrough' },
            ].map((row, i) => (
              <Surface key={i} style={row.done ? { background: HF.okLo, borderColor: '#CFE1CB' } : {}}>
                <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: HF.r.pill, flex: '0 0 28px',
                    background: row.done ? HF.ok : HF.paper,
                    border: `1.5px solid ${row.done ? HF.ok : HF.border}`,
                    display: 'grid', placeItems: 'center',
                  }}>
                    {row.done ? <Icon name="check" size={14} color={HF.paper} /> : <span style={{ fontSize: 14 }}>{row.icon}</span>}
                  </div>
                  <div style={{ flex: 1 }}>
                    <P size={12} weight={700} style={{
                      textDecoration: row.done ? 'line-through' : 'none',
                      opacity: row.done ? 0.7 : 1,
                    }}>{row.l}</P>
                    <P size={10} color={HF.ink3}>{row.sub}</P>
                  </div>
                </div>
              </Surface>
            ))}
          </div>
        </div>

        {/* What Frank does with you */}
        <div>
          <Eyebrow color={HF.ink3}>What Frank does with you</Eyebrow>
          <div style={{ height: 8 }} />
          <span data-uh-routed="true" onClick={() => window.__UH_GO_TO__ && window.__UH_GO_TO__('mo-deposit')} style={{ display: 'block' }}>
            <Surface raised style={{ borderColor: HF.accent, background: HF.accentLo, cursor: 'pointer' }}>
            <div style={{ padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 20 }}>🚶</span>
                <div style={{ flex: 1 }}>
                  <H3 style={{ fontSize: 14 }}>Move-out walkthrough</H3>
                  <P size={11} color={HF.ink3}>Jun 30 · 4:00 PM with Frank</P>
                </div>
                <button style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  fontFamily: HF.body, fontSize: 11, fontWeight: 700, color: HF.accent,
                  textDecoration: 'underline',
                }}>reschedule</button>
              </div>
              <P size={11} color={HF.ink2} style={{ marginTop: 8, lineHeight: 1.4 }}>
                Frank inspects room by room, compares against your move-in condition report, and you both
                sign. This protects your deposit.
              </P>
            </div>
          </Surface>
          </span>
        </div>
      </div>

      <TenantNav active="home" />
    </MobileFrame>
  );
}

// ── 5.3 Walkthrough + deposit disposition ────────────────────────────
function V2MoveOutDeposit() {
  return (
    <MobileFrame label="Deposit · 21-day disposition" h={2100}>
      <div style={{ padding: '10px 20px 14px', background: HF.paper, borderBottom: `1px solid ${HF.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button style={{
            width: 36, height: 36, borderRadius: HF.r.pill, background: HF.cream,
            border: `1px solid ${HF.border}`, cursor: 'pointer',
            display: 'grid', placeItems: 'center',
          }}><Icon name="arrowLeft" size={16} color={HF.ink} /></button>
          <H3 style={{ fontSize: 16, flex: 1 }}>Walkthrough complete</H3>
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
        <H1 style={{ fontSize: 28, textAlign: 'center' }}>You're all done</H1>
        <P size={13} color={HF.ink3} style={{ textAlign: 'center', lineHeight: 1.5 }}>
          Walkthrough signed Jun 30 · keys returned · deposit on the way.
        </P>

        {/* Deposit countdown · primary */}
        <Surface raised style={{ background: HF.ok, color: HF.paper, border: 'none' }}>
          <div style={{ padding: '18px 20px' }}>
            <Eyebrow color="rgba(255,255,255,0.85)">Deposit refund</Eyebrow>
            <div style={{ marginTop: 4, display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontFamily: HF.display, fontWeight: 800, fontSize: 42, color: HF.paper, letterSpacing: '-0.02em' }}>
                $400.00
              </span>
              <Tag tone="ok" style={{ background: HF.paper, color: HF.ok, border: 'none' }}>full refund</Tag>
            </div>
            <P size={12} color="rgba(255,255,255,0.85)" style={{ marginTop: 8 }}>
              Paid by ACH within 21 days (NRS 118A.242). Estimated arrival Jul 5–14.
            </P>
            <div style={{
              marginTop: 12, paddingTop: 12, borderTop: `1px dashed rgba(255,255,255,0.4)`,
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <Icon name="map" size={14} color={HF.paper} />
              <P size={11} color="rgba(255,255,255,0.85)" style={{ flex: 1 }}>
                Mailing to 4421 N Tonopah Dr, Las Vegas NV 89108
              </P>
            </div>
          </div>
        </Surface>

        {/* Itemized */}
        <Surface>
          <div style={{ padding: '14px 16px' }}>
            <Eyebrow color={HF.ink3}>Itemized statement</Eyebrow>
            <div style={{ marginTop: 8 }}>
              {[
                ['Original deposit', '$400.00'],
                ['Cleaning charges', '$0.00'],
                ['Damage repairs', '$0.00'],
                ['Unpaid rent', '$0.00'],
                ['Replacement keys', '$0.00'],
              ].map((row, i) => (
                <div key={i} style={{
                  display: 'flex', justifyContent: 'space-between',
                  padding: '5px 0', borderBottom: `1px dotted ${HF.border}`,
                }}>
                  <P size={12} color={HF.ink2}>{row[0]}</P>
                  <P size={12} weight={600}>{row[1]}</P>
                </div>
              ))}
              <div style={{
                marginTop: 8, padding: '10px 0 0',
                display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                borderTop: `2px solid ${HF.ink}`,
              }}>
                <H3>Refund total</H3>
                <span style={{ fontFamily: HF.display, fontWeight: 800, fontSize: 22, color: HF.ok }}>
                  $400.00
                </span>
              </div>
            </div>
          </div>
        </Surface>

        {/* Move-in vs. move-out comparison */}
        <Surface>
          <div style={{ padding: '14px 16px' }}>
            <Eyebrow color={HF.ink3}>Condition report · move-in vs. move-out</Eyebrow>
            <div style={{ marginTop: 10 }}>
              {[
                { l: 'Living room', in: 'Good', out: 'Good', match: true },
                { l: 'Kitchen', in: 'Good', out: 'Good', match: true },
                { l: 'Bedroom 1', in: 'Good', out: 'Good', match: true },
                { l: 'Bedroom 2', in: 'Good', out: 'Good', match: true },
                { l: 'Bathroom', in: 'Good', out: 'Good', match: true },
                { l: 'Carpets', in: 'Good', out: 'Good', match: true },
              ].map((row, i) => (
                <div key={i} style={{
                  display: 'grid', gridTemplateColumns: '1fr auto auto 22px', gap: 10,
                  padding: '5px 0', borderBottom: i === 5 ? 'none' : `1px dotted ${HF.border}`,
                  alignItems: 'center',
                }}>
                  <P size={12} weight={600}>{row.l}</P>
                  <P size={11} color={HF.ink3}>in: {row.in}</P>
                  <P size={11} color={HF.ok}>out: {row.out}</P>
                  <Icon name="check" size={14} color={HF.ok} />
                </div>
              ))}
            </div>
          </div>
        </Surface>

        <Surface style={{ background: HF.sageLo, borderColor: '#D2DDC9' }}>
          <div style={{ padding: '12px 14px' }}>
            <P size={11} color={HF.ink2} style={{ lineHeight: 1.5 }}>
              <b style={{ color: HF.sage }}>Thank you, Marisol.</b>{' '}
              We loved having you at Juan Garcia. If you ever want to come back, your past
              tenancy and on-time payment history fast-tracks your re-application.
            </P>
          </div>
        </Surface>

        <Button variant="primary" size="lg" full>Download statement (PDF)</Button>
        <div style={{ textAlign: 'center' }}>
          <button data-uh-routed="true"
            onClick={() => window.__UH_GO_TO__ && window.__UH_GO_TO__('browse-mobile')}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              fontFamily: HF.body, fontSize: 12, fontWeight: 700, color: HF.ink3,
              textDecoration: 'underline',
          }}>Browse other Universal Housing communities</button>
        </div>
      </div>

      <TenantNav active="home" />
    </MobileFrame>
  );
}

Object.assign(window, { V2MoveOutIntent, V2MoveOutChecklist, V2MoveOutDeposit });
