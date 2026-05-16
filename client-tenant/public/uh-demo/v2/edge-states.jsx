// V2 · Phase 9D — Empty / error / edge states. The screens we've been
// showing only the happy path of. 6 mobile screens.

// ── 9D.1 First-time browse · no shortlist ───────────────────────────
function V2EmptyShortlist() {
  return (
    <MobileFrame label="Saved · empty state · first-time visitor" h={1700}>
      <div style={{ padding: '10px 20px 14px', background: HF.paper, borderBottom: `1px solid ${HF.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button style={{
            width: 36, height: 36, borderRadius: HF.r.pill, background: HF.cream,
            border: `1px solid ${HF.border}`, cursor: 'pointer',
            display: 'grid', placeItems: 'center',
          }}><Icon name="arrowLeft" size={16} color={HF.ink} /></button>
          <H3 style={{ fontSize: 16, flex: 1 }}>Saved</H3>
        </div>
      </div>

      <div style={{ padding: '24px 20px 100px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        {/* Illustration */}
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <div style={{
            width: 120, height: 120, borderRadius: HF.r.pill, margin: '0 auto',
            background: HF.accentLo, border: `3px dashed ${HF.accent}`,
            display: 'grid', placeItems: 'center',
          }}>
            <Icon name="heart" size={48} color={HF.accent} />
          </div>
        </div>

        <div style={{ textAlign: 'center' }}>
          <H1 style={{ fontSize: 26 }}>Save what you love</H1>
          <P size={13} color={HF.ink2} style={{ marginTop: 8, lineHeight: 1.5, padding: '0 20px' }}>
            Tap the heart on any property to save it here. Compare your top 3
            side-by-side and apply to the one that fits.
          </P>
        </div>

        <Surface raised>
          <div style={{ padding: '14px 16px' }}>
            <Eyebrow color={HF.accent}>3 things shortlisting unlocks</Eyebrow>
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { icon: '⚖', l: 'Side-by-side compare', sub: 'Rent, walk score, neighborhood' },
                { icon: '🔔', l: 'Vacancy alerts', sub: 'Push + email when a unit opens' },
                { icon: '⏱', l: 'Skip browsing each visit', sub: 'Your favorites are 2 taps away' },
              ].map((row, i) => (
                <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: HF.r.pill,
                    background: HF.cream, display: 'grid', placeItems: 'center',
                    flex: '0 0 36px', fontSize: 16,
                  }}>{row.icon}</div>
                  <div style={{ flex: 1 }}>
                    <P size={13} weight={700}>{row.l}</P>
                    <P size={11} color={HF.ink3}>{row.sub}</P>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Surface>

        <span data-uh-routed="true" onClick={() => window.__UH_GO_TO__ && window.__UH_GO_TO__('browse-mobile')}>
          <Button variant="primary" size="lg" full>
            Start browsing
            <Icon name="arrow" size={16} color={HF.paper} style={{ marginLeft: 4 }} />
          </Button>
        </span>
      </div>

      <TenantNav />
    </MobileFrame>
  );
}

// ── 9D.2 All 16 properties full ─────────────────────────────────────
function V2AllFull() {
  return (
    <MobileFrame label="All 16 communities waitlisted · graceful state" h={1900}>
      <div style={{ padding: '10px 20px 14px', background: HF.paper, borderBottom: `1px solid ${HF.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button style={{
            width: 36, height: 36, borderRadius: HF.r.pill, background: HF.cream,
            border: `1px solid ${HF.border}`, cursor: 'pointer',
            display: 'grid', placeItems: 'center',
          }}><Icon name="arrowLeft" size={16} color={HF.ink} /></button>
          <H3 style={{ fontSize: 16, flex: 1 }}>All communities</H3>
        </div>
      </div>

      <div style={{ padding: '24px 20px 100px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Surface raised style={{ background: HF.warnLo, borderColor: '#E8D6A8' }}>
          <div style={{ padding: '18px 20px' }}>
            <Eyebrow color={HF.warn}>Portfolio-wide notice</Eyebrow>
            <H1 style={{ fontSize: 26, marginTop: 8 }}>
              All 16 GPMGLV communities have waitlists right now.
            </H1>
            <P size={13} color={HF.ink2} style={{ marginTop: 10, lineHeight: 1.55 }}>
              Affordable housing demand in Las Vegas exceeds availability across our entire
              portfolio. We've automatically saved your spot — and we'll contact you the
              moment a unit opens anywhere in the portfolio.
            </P>
          </div>
        </Surface>

        {/* Position summary */}
        <Surface>
          <div style={{ padding: '14px 16px' }}>
            <Eyebrow color={HF.ink3}>Your saved spots</Eyebrow>
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                ['2BR · Juan Garcia', '#12', '~4 months'],
                ['2BR · Fletcher', '#8', '~2 months'],
                ['2BR · Sarann Knight', '#9', '~3 months'],
                ['3BR · Juan Garcia (upsize)', '#3', '~3 weeks'],
              ].map((row, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 10px', borderRadius: HF.r.sm,
                  background: HF.cream, border: `1px solid ${HF.border}`,
                }}>
                  <P size={12} weight={600}>{row[0]}</P>
                  <div style={{ textAlign: 'right' }}>
                    <P size={11} weight={700} color={HF.accent}>{row[1]}</P>
                    <P size={10} color={HF.ink3}>{row[2]}</P>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Surface>

        {/* What we do */}
        <Surface>
          <div style={{ padding: '14px 16px' }}>
            <Eyebrow color={HF.sage}>What happens while you wait</Eyebrow>
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                'You move up automatically as people ahead accept or decline.',
                'You\'ll get push + email + SMS the instant a matching unit opens.',
                'Veterans + government-agency referrals jump ahead of standard FIFO.',
              ].map((line, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <Icon name="check" size={14} color={HF.sage} style={{ marginTop: 3, flex: '0 0 14px' }} />
                  <P size={12}>{line}</P>
                </div>
              ))}
            </div>
          </div>
        </Surface>

        {/* Resources */}
        <Surface>
          <div style={{ padding: '14px 16px' }}>
            <Eyebrow color={HF.ink3}>While you wait, these can help</Eyebrow>
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[
                { icon: '🏥', l: 'SNHSP · homelessness services', sub: '(702) 455-4071 · agency referrals jump the queue', target: 'referral' },
                { icon: '🤝', l: 'Clark County Housing Authority', sub: 'Section 8 vouchers · welcomed at all 16 communities', target: 'referral' },
                { icon: '☎', l: '211 Nevada · general help', sub: 'Food, transportation, utility assistance', target: 'inbox' },
              ].map((row, i) => (
                <span key={i} data-uh-routed="true"
                      onClick={() => window.__UH_GO_TO__ && window.__UH_GO_TO__(row.target)}
                      style={{ display: 'block' }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 10px', borderRadius: HF.r.sm,
                    border: `1px solid ${HF.border}`, cursor: 'pointer',
                  }}>
                    <span style={{ fontSize: 16 }}>{row.icon}</span>
                    <div style={{ flex: 1 }}>
                      <P size={12} weight={700}>{row.l}</P>
                      <P size={10} color={HF.ink3}>{row.sub}</P>
                    </div>
                    <Icon name="arrow" size={14} color={HF.ink3} />
                  </div>
                </span>
              ))}
            </div>
          </div>
        </Surface>
      </div>

      <TenantNav active="home" />
    </MobileFrame>
  );
}

// ── 9D.3 Application denied / withdrawn ─────────────────────────────
function V2AppDenied() {
  return (
    <MobileFrame label="Application status · denied · refund pending" h={1900}>
      <div style={{ padding: '10px 20px 14px', background: HF.paper, borderBottom: `1px solid ${HF.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button style={{
            width: 36, height: 36, borderRadius: HF.r.pill, background: HF.cream,
            border: `1px solid ${HF.border}`, cursor: 'pointer',
            display: 'grid', placeItems: 'center',
          }}><Icon name="arrowLeft" size={16} color={HF.ink} /></button>
          <H3 style={{ fontSize: 16, flex: 1 }}>Application status</H3>
        </div>
      </div>

      <div style={{ padding: '24px 20px 100px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Verdict — warm, not cold */}
        <Surface raised style={{ background: HF.errLo, borderColor: '#EDCBC4' }}>
          <div style={{ padding: '18px 20px' }}>
            <Eyebrow color={HF.err}>Application #APP-26-9341</Eyebrow>
            <H1 style={{ fontSize: 24, marginTop: 8 }}>
              We couldn't approve this application
            </H1>
            <P size={13} color={HF.ink2} style={{ marginTop: 8, lineHeight: 1.55 }}>
              This isn't a reflection of you, and it's not final. Below is exactly
              why, what you can do, and how to apply again — most denials are
              fixable in 30–90 days.
            </P>
          </div>
        </Surface>

        {/* Reason */}
        <Surface>
          <div style={{ padding: '14px 16px' }}>
            <Eyebrow color={HF.ink3}>Why this application was denied</Eyebrow>
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                {
                  l: 'Income above 60% AMI cap',
                  body: 'Your verified annual income ($53,200) exceeds the $50,580 limit for a 4-person household at Juan Garcia\'s 60% AMI band.',
                  tone: 'err',
                },
              ].map((r, i) => (
                <div key={i} style={{
                  padding: '12px 14px', borderRadius: HF.r.sm,
                  background: HF.errLo, border: `1px solid #EDCBC4`,
                }}>
                  <P size={12} weight={700} color={HF.err}>{r.l}</P>
                  <P size={11} color={HF.ink2} style={{ marginTop: 4, lineHeight: 1.5 }}>{r.body}</P>
                </div>
              ))}
            </div>
          </div>
        </Surface>

        {/* What you can do */}
        <Surface style={{ background: HF.sageLo, borderColor: '#D2DDC9' }}>
          <div style={{ padding: '14px 16px' }}>
            <Eyebrow color={HF.sage}>What you can do</Eyebrow>
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                {
                  n: 1, l: 'Apply to a community in a different AMI band',
                  body: 'Hoggard + Sarann Knight have 80% AMI units that your income qualifies for.',
                  action: 'See 80% AMI matches', target: 'browse-mobile',
                },
                {
                  n: 2, l: 'Reapply if your income changes',
                  body: 'Job change · reduced hours · household composition change — any of these may move you back under the cap.',
                  action: 'Set up an alert', target: 'acct-prefs',
                },
                {
                  n: 3, l: 'Appeal this decision',
                  body: 'Within 14 days. Frank Hawkins reviews appeals personally.',
                  action: 'Start appeal', target: 'inbox',
                },
              ].map((row, i) => (
                <div key={i} style={{
                  padding: '10px 12px', borderRadius: HF.r.sm,
                  background: HF.paper, border: `1px solid ${HF.sage}`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <div style={{
                      width: 22, height: 22, borderRadius: HF.r.pill, flex: '0 0 22px',
                      background: HF.sage, color: HF.paper,
                      display: 'grid', placeItems: 'center',
                      fontFamily: HF.display, fontWeight: 800, fontSize: 11,
                    }}>{row.n}</div>
                    <div style={{ flex: 1 }}>
                      <P size={12} weight={700}>{row.l}</P>
                      <P size={11} color={HF.ink3} style={{ marginTop: 2, lineHeight: 1.4 }}>{row.body}</P>
                      <button data-uh-routed="true"
                        onClick={() => window.__UH_GO_TO__ && window.__UH_GO_TO__(row.target)}
                        style={{
                          background: 'transparent', border: 'none', cursor: 'pointer',
                          marginTop: 6, padding: 0,
                          fontFamily: HF.body, fontSize: 11, fontWeight: 700, color: HF.sage,
                          textDecoration: 'underline',
                        }}>{row.action} →</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Surface>

        {/* Refund */}
        <Surface>
          <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 44, height: 44, borderRadius: HF.r.pill, background: HF.warnLo,
              border: `1.5px solid ${HF.warn}`, color: HF.warn,
              display: 'grid', placeItems: 'center', flex: '0 0 44px', fontSize: 18,
            }}>💸</div>
            <div style={{ flex: 1 }}>
              <P size={12} weight={700}>$35.95 fee refund pending</P>
              <P size={11} color={HF.ink3} style={{ marginTop: 2, lineHeight: 1.4 }}>
                Because document review didn't complete, you qualify for a partial refund.
                Processing 5–10 business days.
              </P>
            </div>
          </div>
        </Surface>
      </div>
    </MobileFrame>
  );
}

// ── 9D.4 Payment declined ───────────────────────────────────────────
function V2PaymentDeclined() {
  return (
    <MobileFrame label="Payment · declined · retry options" h={1700}>
      <div style={{ padding: '10px 20px 14px', background: HF.paper, borderBottom: `1px solid ${HF.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button style={{
            width: 36, height: 36, borderRadius: HF.r.pill, background: HF.cream,
            border: `1px solid ${HF.border}`, cursor: 'pointer',
            display: 'grid', placeItems: 'center',
          }}><Icon name="arrowLeft" size={16} color={HF.ink} /></button>
          <H3 style={{ fontSize: 16, flex: 1 }}>Payment</H3>
        </div>
      </div>

      <div style={{ padding: '24px 20px 100px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Status */}
        <div style={{ textAlign: 'center', padding: '8px 0' }}>
          <div style={{
            width: 80, height: 80, borderRadius: HF.r.pill, margin: '0 auto',
            background: HF.errLo, border: `3px solid ${HF.err}`,
            display: 'grid', placeItems: 'center',
          }}>
            <Icon name="warning" size={36} color={HF.err} />
          </div>
        </div>

        <div style={{ textAlign: 'center' }}>
          <H1 style={{ fontSize: 26 }}>Your card was declined</H1>
          <P size={13} color={HF.ink3} style={{ marginTop: 8, lineHeight: 1.5 }}>
            Heartland reported: <b style={{ color: HF.err }}>insufficient funds</b>.
            No charge was made. Your application is still saved.
          </P>
        </div>

        {/* What happened */}
        <Surface>
          <div style={{ padding: '14px 16px' }}>
            <Eyebrow color={HF.ink3}>What happened</Eyebrow>
            <div style={{
              marginTop: 8, padding: '10px 12px', borderRadius: HF.r.sm,
              background: HF.errLo, border: `1px solid #EDCBC4`,
            }}>
              <P size={11} style={{ fontFamily: HF.mono, color: HF.err }}>
                AUTH FAIL · code 51 · insufficient funds
              </P>
              <P size={10} color={HF.ink3} style={{ marginTop: 4 }}>
                VISA •••• 4242 · May 14 · 9:14 AM · Heartland transaction HRT-2026-05-14-9341-A8C2
              </P>
            </div>
          </div>
        </Surface>

        {/* Try another */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Eyebrow color={HF.ink3}>Try a different payment method</Eyebrow>
          {[
            { l: 'Wells Fargo ACH •••• 8821', sub: 'Bank transfer · 1 day to clear', icon: 'ACH', color: HF.sage, primary: true },
            { l: 'Add a new debit card', sub: 'Debit only · per lease §2.A', icon: '+', color: HF.ink3 },
            { l: 'Apple Pay', sub: 'Linked to your bank account', icon: '', color: HF.ink },
          ].map((m, i) => (
            <Surface key={i} raised={m.primary}
              style={m.primary ? { borderColor: HF.sage, background: HF.sageLo } : {}}>
              <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 40, height: 28, borderRadius: 4, background: m.color, color: HF.paper,
                  display: 'grid', placeItems: 'center', fontFamily: HF.display, fontWeight: 800, fontSize: 9,
                  flex: '0 0 40px',
                }}>{m.icon || 'AP'}</div>
                <div style={{ flex: 1 }}>
                  <P size={12} weight={700}>{m.l}</P>
                  <P size={10} color={HF.ink3}>{m.sub}</P>
                </div>
                {m.primary && <Tag tone="sage">Recommended</Tag>}
              </div>
            </Surface>
          ))}
        </div>

        <span data-uh-routed="true" onClick={() => window.__UH_GO_TO__ && window.__UH_GO_TO__('apply-4')}>
          <Button variant="primary" size="lg" full>
            Retry $71.90 with ACH
            <Icon name="arrow" size={16} color={HF.paper} style={{ marginLeft: 4 }} />
          </Button>
        </span>

        <Surface>
          <div style={{ padding: '10px 14px' }}>
            <P size={11} color={HF.ink3} style={{ lineHeight: 1.5 }}>
              <b style={{ color: HF.ink }}>Need help paying?</b> SNHSP and other agencies cover
              application fees for verified applicants. <button style={{
                background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
                fontFamily: HF.body, fontSize: 11, fontWeight: 700, color: HF.accent,
                textDecoration: 'underline',
              }}>See referral options →</button>
            </P>
          </div>
        </Surface>
      </div>
    </MobileFrame>
  );
}

// ── 9D.5 No-data states (composite screen showing 4 patterns) ───────
function V2NoData() {
  const Tile = ({ icon, l, sub }) => (
    <Surface>
      <div style={{ padding: '20px 18px', textAlign: 'center', minHeight: 200, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{
          width: 56, height: 56, borderRadius: HF.r.pill, margin: '0 auto',
          background: HF.cream, border: `1.5px solid ${HF.border}`,
          display: 'grid', placeItems: 'center', fontSize: 24, color: HF.ink3,
        }}>{icon}</div>
        <P size={13} weight={700} style={{ marginTop: 10 }}>{l}</P>
        <P size={10} color={HF.ink3} style={{ marginTop: 4, lineHeight: 1.4 }}>{sub}</P>
      </div>
    </Surface>
  );

  return (
    <MobileFrame label="No-data states · empty tabs" h={1900}>
      <div style={{ padding: '10px 20px 14px', background: HF.paper, borderBottom: `1px solid ${HF.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <H3 style={{ fontSize: 16, flex: 1 }}>Empty states</H3>
        </div>
      </div>

      <div style={{ padding: '20px 20px 100px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <P size={11} color={HF.ink3}>
          Each tab has a calm, useful first-visit state — no awkward blanks.
        </P>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Tile
            icon="📭"
            l="No messages yet"
            sub="Your PM will reach out when needed. The AI chat is always here."
          />
          <Tile
            icon="🔧"
            l="No open repairs"
            sub="Tap + below to submit a new work order."
          />
          <Tile
            icon="📁"
            l="No documents uploaded"
            sub="Upload your 5 required docs to lock your application."
          />
          <Tile
            icon="📜"
            l="No activity yet"
            sub="Your rent payments and PM interactions will show up here."
          />
        </div>

        <Surface raised style={{ marginTop: 8 }}>
          <div style={{ padding: '16px 18px' }}>
            <Eyebrow color={HF.accent}>Empty state design rules</Eyebrow>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[
                'Always show what the space is for, not just that it\'s empty.',
                'Provide one obvious next action (button, link, or AI prompt).',
                'Calm tone — no apologies, no scolding.',
                'Use a soft outlined icon, never a stock illustration.',
              ].map((line, i) => (
                <div key={i} style={{ display: 'flex', gap: 6 }}>
                  <Icon name="check" size={12} color={HF.accent} style={{ marginTop: 4, flex: '0 0 12px' }} />
                  <P size={12}>{line}</P>
                </div>
              ))}
            </div>
          </div>
        </Surface>
      </div>

      <TenantNav active="msg" />
    </MobileFrame>
  );
}

// ── 9D.6 Offline state ──────────────────────────────────────────────
function V2Offline() {
  return (
    <MobileFrame label="Offline · cached + graceful" h={1700}>
      {/* Offline banner over status bar area */}
      <div style={{
        padding: '8px 20px', background: HF.warn, color: HF.paper,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ fontSize: 14 }}>📵</span>
        <P size={11} weight={700} color={HF.paper} style={{ flex: 1 }}>
          You're offline · changes will sync when you reconnect
        </P>
        <button style={{
          background: 'rgba(255,255,255,0.2)', color: HF.paper, border: 'none', cursor: 'pointer',
          padding: '4px 8px', borderRadius: HF.r.sm,
          fontFamily: HF.body, fontSize: 10, fontWeight: 700,
        }}>Retry</button>
      </div>

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

      <div style={{ padding: '14px 20px 100px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <PropertyAnchor />

        {/* Available offline */}
        <Surface>
          <div style={{ padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Eyebrow color={HF.sage}>Cached · available offline</Eyebrow>
              <span style={{ fontSize: 12 }}>📂</span>
            </div>
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { icon: '🔑', l: 'Lease + addenda', sub: 'Read & download' },
                { icon: '📊', l: 'Calc tape audit trail', sub: 'Last opened Jul 8' },
                { icon: '✉', l: 'Inbox · 2 recent messages', sub: 'Read-only · responses sync later' },
                { icon: '📅', l: 'Bills due dates', sub: 'Through end of August' },
                { icon: '🆘', l: 'Emergency contacts', sub: 'Frank · NV Legal · 211' },
              ].map((row, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 10px', borderRadius: HF.r.sm,
                  background: HF.cream, border: `1px solid ${HF.border}`,
                }}>
                  <span style={{ fontSize: 16 }}>{row.icon}</span>
                  <div style={{ flex: 1 }}>
                    <P size={12} weight={700}>{row.l}</P>
                    <P size={10} color={HF.ink3}>{row.sub}</P>
                  </div>
                  <Icon name="arrow" size={14} color={HF.ink3} />
                </div>
              ))}
            </div>
          </div>
        </Surface>

        {/* Not available */}
        <Surface style={{ background: HF.warnLo, borderColor: '#E8D6A8' }}>
          <div style={{ padding: '14px 16px' }}>
            <Eyebrow color={HF.warn}>Needs internet</Eyebrow>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {[
                'Paying rent or fees',
                'Submitting a new work order',
                'Signing documents (DocuSign)',
                'Browsing new properties',
              ].map((l, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <Icon name="close" size={12} color={HF.warn} />
                  <P size={12} color={HF.ink2}>{l}</P>
                </div>
              ))}
            </div>
            <P size={10} color={HF.ink3} style={{ marginTop: 10, lineHeight: 1.4 }}>
              We'll queue any changes you make and submit them when you reconnect.
            </P>
          </div>
        </Surface>

        <Surface>
          <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 14 }}>📡</span>
            <P size={11} color={HF.ink2} style={{ flex: 1, lineHeight: 1.4 }}>
              Universal Housing caches your last 30 days of data so you can keep using it
              even without service.
            </P>
          </div>
        </Surface>
      </div>

      <TenantNav active="home" />
    </MobileFrame>
  );
}

Object.assign(window, {
  V2EmptyShortlist, V2AllFull, V2AppDenied, V2PaymentDeclined, V2NoData, V2Offline,
});
