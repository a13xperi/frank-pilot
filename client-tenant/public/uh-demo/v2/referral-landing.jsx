// V2 · Phase 9A — Government Agency Referral landing.
// Per G9.5: when an agency emails referrals@gpmglv.org, the engine parses
// the email, validates the sender, extracts the prospect's data, and sends
// them a personalized link. They tap it and land HERE — pre-filled, priority
// placement attached, agency context surfaced.

function V2ReferralLanding() {
  return (
    <MobileFrame label="Referral landing · SNHSP deep-link" h={1900}>
      {/* Status bar replacement — agency-branded strip */}
      <div style={{
        padding: '12px 20px', background: HF.sage, color: HF.paper,
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: HF.r.sm, background: HF.paper, color: HF.sage,
          display: 'grid', placeItems: 'center', fontFamily: HF.display, fontWeight: 800, fontSize: 12,
          flex: '0 0 32px',
        }}>SN</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Eyebrow color="rgba(255,255,255,0.85)">Referred by</Eyebrow>
          <P size={12} weight={700} color={HF.paper}>
            Southern Nevada Homelessness Services Program
          </P>
        </div>
        <Tag tone="sage" style={{ background: HF.paper, color: HF.sage, border: 'none' }}>
          ★ Priority
        </Tag>
      </div>

      <div style={{ padding: '24px 20px 100px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Hero */}
        <div>
          <Eyebrow>Welcome, Marisol</Eyebrow>
          <H1 style={{ fontSize: 30, marginTop: 8, letterSpacing: '-0.02em' }}>
            Your spot is already saved.
          </H1>
          <P size={14} color={HF.ink2} style={{ marginTop: 8, lineHeight: 1.55 }}>
            SNHSP referred you to Universal Housing. We've pre-qualified your application
            and placed you ahead of the standard waitlist queue. You just need to confirm
            a few details to lock it in.
          </P>
        </div>

        {/* Priority card */}
        <Surface raised style={{ background: HF.sage, border: 'none', color: HF.paper }}>
          <div style={{ padding: '18px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 18 }}>★</span>
              <Eyebrow color="rgba(255,255,255,0.85)">Government Agency Priority</Eyebrow>
            </div>
            <H2 style={{ fontSize: 22, color: HF.paper, marginTop: 6 }}>
              Top of the 2BR waitlist
            </H2>
            <P size={12} color="rgba(255,255,255,0.85)" style={{ marginTop: 6, lineHeight: 1.5 }}>
              Verified agency referrals jump ahead of standard FIFO applicants.
              Multiple priority referrals are FIFO among themselves by received time.
            </P>
            <div style={{
              marginTop: 14, paddingTop: 14, borderTop: `1px dashed rgba(255,255,255,0.4)`,
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12,
            }}>
              <div>
                <Eyebrow color="rgba(255,255,255,0.85)">Your position</Eyebrow>
                <P size={20} weight={700} color={HF.paper} style={{ fontFamily: HF.display, marginTop: 2 }}>#3</P>
              </div>
              <div>
                <Eyebrow color="rgba(255,255,255,0.85)">Standard list</Eyebrow>
                <P size={13} color="rgba(255,255,255,0.85)" style={{ marginTop: 6, textDecoration: 'line-through' }}>
                  would have been #38
                </P>
              </div>
            </div>
          </div>
        </Surface>

        {/* Pre-filled property card */}
        <Surface>
          <div style={{ padding: '14px 16px' }}>
            <Eyebrow color={HF.ink3}>Pre-selected for you</Eyebrow>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
              <div style={{
                width: 64, height: 64, borderRadius: HF.r.md, flex: '0 0 64px',
                background: `#c4b496 url(${propBySlug('juan-garcia').photo}) center/cover`,
              }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <H3 style={{ fontSize: 14 }}>Juan Garcia Garden Apts</H3>
                <P size={11} color={HF.ink3}>2BR · Family · East Las Vegas</P>
                <div style={{ display: 'flex', gap: 5, marginTop: 6, flexWrap: 'wrap' }}>
                  <Tag tone="sage">SNHSP-approved match</Tag>
                </div>
              </div>
            </div>
            <button style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              fontFamily: HF.body, fontSize: 11, fontWeight: 700, color: HF.accent,
              marginTop: 10, textDecoration: 'underline',
            }}>Change property →</button>
          </div>
        </Surface>

        {/* What SNHSP already verified */}
        <Surface style={{ background: HF.sageLo, borderColor: '#D2DDC9' }}>
          <div style={{ padding: '14px 16px' }}>
            <Eyebrow color={HF.sage}>SNHSP has already verified</Eyebrow>
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[
                'Identity (Driver\'s License + SSN)',
                'Annual household income · $42,800',
                'Household size · 2 (1 adult + 1 minor)',
                'No prior eviction history',
              ].map((line, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Icon name="check" size={14} color={HF.sage} />
                  <P size={12}>{line}</P>
                </div>
              ))}
            </div>
            <P size={10} color={HF.ink3} style={{ marginTop: 10, lineHeight: 1.4 }}>
              Carried directly from your SNHSP case file. We won't re-ask for these.
            </P>
          </div>
        </Surface>

        {/* What's left for Marisol */}
        <Surface>
          <div style={{ padding: '14px 16px' }}>
            <Eyebrow color={HF.ink3}>What we still need from you</Eyebrow>
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { l: 'Confirm contact info', sub: '~30 seconds' },
                { l: 'Pay $35.95 application fee', sub: 'fee waived for SNHSP referrals · skipped', waived: true },
                { l: 'Sign electronic application', sub: 'DocuSign · ~3 minutes' },
              ].map((row, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 10px', borderRadius: HF.r.sm,
                  background: row.waived ? HF.sageLo : HF.cream,
                  border: `1px solid ${row.waived ? '#D2DDC9' : HF.border}`,
                  opacity: row.waived ? 0.7 : 1,
                }}>
                  <div style={{
                    width: 22, height: 22, borderRadius: HF.r.pill, flex: '0 0 22px',
                    background: row.waived ? HF.sage : HF.accent, color: HF.paper,
                    display: 'grid', placeItems: 'center',
                    fontFamily: HF.display, fontWeight: 800, fontSize: 11,
                  }}>{row.waived ? '✓' : i + 1}</div>
                  <div style={{ flex: 1 }}>
                    <P size={12} weight={700} style={{ textDecoration: row.waived ? 'line-through' : 'none' }}>
                      {row.l}
                    </P>
                    <P size={10} color={HF.ink3}>{row.sub}</P>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Surface>

        {/* Caseworker contact */}
        <Surface>
          <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 36, height: 36, borderRadius: HF.r.pill, background: HF.cream,
              border: `1px solid ${HF.border}`, display: 'grid', placeItems: 'center',
              flex: '0 0 36px', fontFamily: HF.display, fontWeight: 700, fontSize: 12,
            }}>DT</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <P size={11} color={HF.ink3}>Your SNHSP caseworker</P>
              <P size={12} weight={700}>David Torres · (702) 555-0199</P>
            </div>
            <button style={{
              padding: '6px 10px', borderRadius: HF.r.sm, background: HF.paper,
              border: `1px solid ${HF.border}`, cursor: 'pointer',
              fontFamily: HF.body, fontWeight: 700, fontSize: 11,
            }}>Message</button>
          </div>
        </Surface>

        <Button variant="primary" size="lg" full>
          Continue · ~3 minutes left
          <Icon name="arrow" size={16} color={HF.paper} style={{ marginLeft: 4 }} />
        </Button>
        <P size={10} color={HF.ink3} style={{ textAlign: 'center' }}>
          Powered by GPMGLV's Government Agency Email Referral Engine
        </P>
      </div>
    </MobileFrame>
  );
}

Object.assign(window, { V2ReferralLanding });
