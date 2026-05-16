// V2 · Move-in transition — Day 74 → Day 90.
// Lease sign → PM walkthrough → utilities → keys/celebration → first tenant home.
// All mobile, all using real Juan Garcia data.

function MoveInHeader({ step, total = 4, name }) {
  const names = ['Lease', 'Walkthrough', 'Utilities', 'Keys'];
  return (
    <div style={{ padding: '8px 20px 14px', background: HF.paper, borderBottom: `1px solid ${HF.border}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <button style={{
          width: 36, height: 36, borderRadius: HF.r.pill, background: HF.cream,
          border: `1px solid ${HF.border}`, cursor: 'pointer',
          display: 'grid', placeItems: 'center',
        }}><Icon name="arrowLeft" size={16} color={HF.ink} /></button>
        <div style={{ flex: 1 }}>
          <Eyebrow>Move-in</Eyebrow>
          <P size={11} color={HF.ink3}>Step {step} of {total} · {names[step - 1]}</P>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        {Array.from({ length: total }).map((_, i) => (
          <div key={i} style={{
            flex: 1, height: 4, borderRadius: 99,
            background: i < step - 1 ? HF.ok : i === step - 1 ? HF.accent : '#E2DCCC',
          }} />
        ))}
      </div>
    </div>
  );
}

// ── 3.1 Lease Sign — DocuSign envelope ───────────────────────────────
function V2LeaseSign() {
  const p = propBySlug('juan-garcia');
  const addenda = [
    { l: 'Community Policies & Procedures', signed: true },
    { l: 'Section 42 LIHTC Addendum', signed: true },
    { l: 'VAWA Lease Addendum (HUD-91067)', signed: true },
    { l: 'Drug-Free Housing Addendum', signed: false },
    { l: 'Crime-Free Lease Addendum', signed: false },
    { l: 'Smoke Detector Agreement', signed: false },
    { l: 'Lead-Based Paint Disclosure', signed: false },
    { l: 'Resident Rules Acknowledgment', signed: false },
  ];
  return (
    <MobileFrame label="Day 74 · DocuSign envelope" h={2200}>
      <MoveInHeader step={1} />
      <div style={{ padding: '20px 20px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <H2 style={{ fontSize: 22 }}>Sign your lease</H2>
          <P size={13} color={HF.ink3} style={{ marginTop: 4 }}>
            Pre-filled from your application. Review then sign with DocuSign.
          </P>
        </div>

        <Surface>
          <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 18 }}>📝</span>
            <P size={12} weight={700} style={{ flex: 1 }}>DocuSign · #DS-26-4488</P>
            <Tag tone="accent">Action required</Tag>
          </div>
        </Surface>

        {/* Lease preview */}
        <Surface raised>
          <div style={{ padding: '14px 16px' }}>
            <div style={{ textAlign: 'center', borderBottom: `1px solid ${HF.border}`, paddingBottom: 8 }}>
              <Eyebrow color={HF.ink3}>Residential Lease Agreement</Eyebrow>
              <H3 style={{ fontSize: 14, marginTop: 2 }}>{p.name}</H3>
            </div>
            <div style={{ marginTop: 10 }}>
              {[
                ['Tenant', 'Marisol R. Cabrera', true],
                ['Co-occupant', 'Sofia Cabrera (minor)', false],
                ['Unit', '2BR · Unit 214 · 905 sqft', true],
                ['Address', p.address, true],
                ['Monthly rent', '$964 (Section 42 LIHTC cap)', true],
                ['Security deposit', '$400.00', false],
                ['Term', '12 months', true],
                ['Start date', 'Jul 15, 2026', true],
                ['End date', 'Jul 14, 2027', true],
                ['Auto-pay', 'Recommended · $10/mo discount', false],
              ].map((row, i) => (
                <div key={i} style={{
                  display: 'grid', gridTemplateColumns: '110px 1fr auto', gap: 8,
                  padding: '5px 0', borderBottom: `1px dotted ${HF.border}`,
                  alignItems: 'baseline',
                }}>
                  <P size={10} color={HF.ink3} weight={600} style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>{row[0]}</P>
                  <P size={12} weight={600}>{row[1]}</P>
                  {row[2] && <Tag tone="ok" style={{ padding: '1px 5px' }}>✓</Tag>}
                </div>
              ))}
            </div>

            <div style={{ marginTop: 14 }}>
              <Eyebrow color={HF.ink3}>Addenda to sign ({addenda.filter(a => a.signed).length} / {addenda.length})</Eyebrow>
              <div style={{ marginTop: 6 }}>
                {addenda.map((a, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '5px 0', borderBottom: i === addenda.length - 1 ? 'none' : `1px dotted ${HF.border}`,
                  }}>
                    <div style={{
                      width: 18, height: 18, borderRadius: HF.r.pill,
                      background: a.signed ? HF.ok : HF.paper,
                      border: `1.5px solid ${a.signed ? HF.ok : HF.ink3}`,
                      display: 'grid', placeItems: 'center',
                    }}>
                      {a.signed && <Icon name="check" size={11} color={HF.paper} />}
                    </div>
                    <P size={12} style={{ flex: 1, color: a.signed ? HF.ink : HF.ink2 }}>{a.l}</P>
                    {!a.signed && (
                      <button style={{
                        background: 'transparent', border: 'none', cursor: 'pointer',
                        fontFamily: HF.body, fontSize: 11, fontWeight: 700, color: HF.accent,
                        textDecoration: 'underline',
                      }}>sign</button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Signature line */}
            <div style={{
              marginTop: 14, padding: '10px 12px', borderRadius: HF.r.md,
              background: HF.accentLo, border: `1.5px dashed ${HF.accent}`,
            }}>
              <Eyebrow color={HF.accent}>Your signature</Eyebrow>
              <div style={{ height: 24, marginTop: 6, borderBottom: `1.5px solid ${HF.ink}` }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                <P size={10} color={HF.ink3}>X — Marisol R. Cabrera</P>
                <P size={10} color={HF.ink3}>Jul 8, 2026</P>
              </div>
            </div>
          </div>
        </Surface>

        <P size={11} color={HF.ink3}>⏱ Est. 4 min to sign all addenda</P>

        <span data-uh-routed="true"
              onClick={() => window.__UH_GO_TO__ && window.__UH_GO_TO__('walkthrough')}>
          <Button variant="primary" size="lg" full>
            Open DocuSign to sign
            <Icon name="arrow" size={16} color={HF.paper} style={{ marginLeft: 4 }} />
          </Button>
        </span>
      </div>
    </MobileFrame>
  );
}

// ── 3.2 PM Walkthrough ───────────────────────────────────────────────
function V2Walkthrough() {
  return (
    <MobileFrame label="Day 75 · PM walkthrough scheduled" h={1900}>
      <MoveInHeader step={2} />
      <div style={{ padding: '20px 20px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <H2 style={{ fontSize: 22 }}>Walkthrough with your PM</H2>
          <P size={13} color={HF.ink3} style={{ marginTop: 4 }}>
            Frank inspects the unit's condition with you before move-in. You do this together.
          </P>
        </div>

        {/* Appointment card — primary */}
        <Surface raised style={{ background: HF.accent, color: HF.paper, border: 'none' }}>
          <div style={{ padding: '18px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 18 }}>🗓</span>
              <Eyebrow color="rgba(255,255,255,0.85)">Scheduled appointment</Eyebrow>
            </div>
            <H1 style={{ fontSize: 28, color: HF.paper, marginTop: 6 }}>Jul 13, 11:00 AM</H1>

            <div style={{
              marginTop: 12, paddingTop: 12, borderTop: `1px dashed rgba(255,255,255,0.4)`,
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <div style={{
                width: 38, height: 38, borderRadius: HF.r.pill, background: HF.paper, color: HF.accent,
                display: 'grid', placeItems: 'center', fontFamily: HF.display, fontWeight: 800, fontSize: 13,
                flex: '0 0 38px',
              }}>FH</div>
              <div style={{ flex: 1 }}>
                <P size={13} weight={700} color={HF.paper}>Frank Hawkins</P>
                <P size={11} color="rgba(255,255,255,0.85)">Meeting you at the unit</P>
              </div>
              <button style={{
                padding: '5px 10px', borderRadius: HF.r.sm,
                background: HF.paper, color: HF.accent, border: 'none', cursor: 'pointer',
                fontFamily: HF.body, fontWeight: 700, fontSize: 11,
              }}>Reschedule</button>
            </div>
            <P size={11} color="rgba(255,255,255,0.85)" style={{ marginTop: 10 }}>
              ⏱ ~30 min · Bring your ID and anyone else who will live with you.
            </P>
          </div>
        </Surface>

        <Surface>
          <div style={{ padding: '14px 16px' }}>
            <Eyebrow color={HF.ink3}>What Frank walks through with you</Eyebrow>
            <div style={{ marginTop: 10 }}>
              {[
                { icon: '🔑', l: 'Unit condition', sub: 'room by room · photos' },
                { icon: '🔧', l: 'Appliances & plumbing', sub: 'verifies everything works' },
                { icon: '🪟', l: 'Locks, windows, detectors', sub: 'smoke + CO installed' },
                { icon: '📜', l: 'Community rules', sub: 'quiet hours · pets · parking' },
                { icon: '🆘', l: 'Emergencies & contacts', sub: '24/7 maint. line · PM contact' },
                { icon: '📝', l: 'Move-in condition form', sub: 'you both sign at the end' },
              ].map((row, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '7px 0', borderTop: i === 0 ? 'none' : `1px dotted ${HF.border}`,
                }}>
                  <span style={{ fontSize: 16, width: 22, textAlign: 'center' }}>{row.icon}</span>
                  <div style={{ flex: 1 }}>
                    <P size={12} weight={700}>{row.l}</P>
                    <P size={11} color={HF.ink3}>{row.sub}</P>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Surface>

        <Surface>
          <div style={{ padding: '10px 12px', display: 'flex', gap: 8 }}>
            <span style={{ fontSize: 14 }}>🛡</span>
            <P size={11} color={HF.ink2} style={{ flex: 1, lineHeight: 1.4 }}>
              You don't do this alone. Frank is on-site for any concerns you want logged.
              Your sign-off protects your deposit at the end.
            </P>
          </div>
        </Surface>

        <span data-uh-routed="true"
              onClick={() => window.__UH_GO_TO__ && window.__UH_GO_TO__('utilities')}>
          <Button variant="primary" size="lg" full>Add to calendar</Button>
        </span>
      </div>
    </MobileFrame>
  );
}

// ── 3.3 Utilities Activation ─────────────────────────────────────────
function V2Utilities() {
  return (
    <MobileFrame label="Day 80 · Activate gas + electric" h={1700}>
      <MoveInHeader step={3} />
      <div style={{ padding: '20px 20px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <H2 style={{ fontSize: 22 }}>Activate utilities</H2>
          <P size={13} color={HF.ink3} style={{ marginTop: 4 }}>
            Gas + electric must be in your name before keys are issued. PM verifies 48h before move-in.
          </P>
        </div>

        {/* Master progress */}
        <Surface raised style={{ background: HF.accentLo, borderColor: '#F3D7CB' }}>
          <div style={{ padding: '12px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <Eyebrow color={HF.accent}>Progress</Eyebrow>
              <span style={{ fontFamily: HF.display, fontWeight: 800, fontSize: 18, color: HF.accent }}>1 / 2</span>
            </div>
            <div style={{ height: 6, marginTop: 8, background: '#FBE5DD', borderRadius: 99, overflow: 'hidden' }}>
              <div style={{ width: '50%', height: '100%', background: HF.accent }} />
            </div>
            <P size={11} color={HF.ink3} style={{ marginTop: 6 }}>Gas confirmed · electric pending</P>
          </div>
        </Surface>

        {/* Gas — done */}
        <Surface style={{ borderColor: HF.ok, background: HF.okLo }}>
          <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{
              width: 36, height: 36, borderRadius: HF.r.pill, background: HF.ok, color: HF.paper,
              display: 'grid', placeItems: 'center', flex: '0 0 36px',
            }}>
              <Icon name="check" size={18} color={HF.paper} />
            </div>
            <div style={{ flex: 1 }}>
              <H3 style={{ fontSize: 14 }}>🔥 Gas · Southwest Gas</H3>
              <P size={11} color={HF.ink3}>Confirmed for Jul 12 · account in your name</P>
              <P size={11} color={HF.ok} weight={600} style={{ marginTop: 4 }}>
                ✓ Frank will verify on Jul 13
              </P>
            </div>
          </div>
        </Surface>

        {/* Electric — pending */}
        <Surface raised style={{ borderColor: HF.accent }}>
          <div style={{ padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <div style={{
                width: 36, height: 36, borderRadius: HF.r.pill, background: HF.paper, border: `2px solid ${HF.accent}`,
                display: 'grid', placeItems: 'center', flex: '0 0 36px', color: HF.accent,
                fontFamily: HF.display, fontWeight: 800, fontSize: 14,
              }}>2</div>
              <div style={{ flex: 1 }}>
                <H3 style={{ fontSize: 14 }}>⚡ Electric · NV Energy</H3>
                <P size={11} color={HF.ink3}>Account in your name · 24h activation</P>
                <Tag tone="warn" style={{ marginTop: 6 }}>Required for move-in</Tag>
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <span data-uh-routed="true"
                    onClick={() => window.__UH_GO_TO__ && window.__UH_GO_TO__('keys')}>
                <Button variant="primary" size="md" full>
                  Set up online with NV Energy
                  <Icon name="arrow" size={14} color={HF.paper} style={{ marginLeft: 4 }} />
                </Button>
              </span>
            </div>
          </div>
        </Surface>

        <Surface>
          <div style={{ padding: '10px 12px' }}>
            <P size={11} color={HF.ink3}>
              ⏱ Frank verifies gas + electric 48h before move-in (Jul 13). No activation = no keys.
            </P>
          </div>
        </Surface>
      </div>
    </MobileFrame>
  );
}

// ── 3.4 Keys & Celebration ───────────────────────────────────────────
function V2Keys() {
  const p = propBySlug('juan-garcia');
  return (
    <MobileFrame label="Day 89 · You're home!" h={1900}>
      <MoveInHeader step={4} />
      <div style={{ padding: '20px 20px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Celebration graphic */}
        <div style={{ textAlign: 'center', padding: '20px 0 8px', position: 'relative' }}>
          <div style={{
            width: 110, height: 110, borderRadius: HF.r.pill, margin: '0 auto',
            background: 'radial-gradient(circle at 30% 30%, #d4e9cf 0%, #b8d3b0 100%)',
            border: `4px solid ${HF.ok}`,
            display: 'grid', placeItems: 'center',
            boxShadow: HF.shadow.lg, position: 'relative',
          }}>
            <span style={{ fontSize: 56 }}>🔑</span>
          </div>
          {/* Confetti */}
          {['🎉', '✨', '🎊', '🌟', '💫'].map((e, i) => (
            <span key={i} style={{
              position: 'absolute', top: `${[10, 30, 70, 50, 100][i]}px`,
              left: `${[40, 280, 60, 290, 160][i]}px`,
              fontSize: 24, transform: `rotate(${i * 30 - 50}deg)`,
            }}>{e}</span>
          ))}
        </div>

        <H1 style={{ fontSize: 34, textAlign: 'center' }}>You're home!</H1>
        <P size={14} color={HF.ink2} style={{ textAlign: 'center', lineHeight: 1.5 }}>
          Marisol, welcome to {p.name}. Your keys are waiting tomorrow at 10 AM.
        </P>

        {/* Pickup card */}
        <Surface raised style={{ borderColor: HF.ok }}>
          <div style={{ padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="pin" size={16} color={HF.ok} />
              <Eyebrow color={HF.ok}>Key pickup</Eyebrow>
            </div>
            <P size={13} weight={700} style={{ marginTop: 6 }}>{p.address}</P>
            <P size={11} color={HF.ink3}>PM office · Building A</P>
            <div style={{
              marginTop: 12, paddingTop: 12, borderTop: `1px dashed ${HF.border}`,
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12,
            }}>
              <div>
                <Eyebrow color={HF.ink3}>When</Eyebrow>
                <P size={14} weight={700} style={{ marginTop: 2 }}>Jul 15 · 10:00 AM</P>
              </div>
              <div>
                <Eyebrow color={HF.ink3}>Your PM</Eyebrow>
                <P size={14} weight={700} style={{ marginTop: 2 }}>Frank Hawkins</P>
              </div>
            </div>
          </div>
        </Surface>

        {/* Transition banner */}
        <Surface style={{ background: HF.accentLo, borderColor: '#F3D7CB' }}>
          <div style={{ padding: '14px 16px' }}>
            <Eyebrow color={HF.accent}>🔄 Applicant → Tenant</Eyebrow>
            <P size={12} color={HF.ink2} style={{ marginTop: 4, lineHeight: 1.5 }}>
              Your account upgrades today. You'll now see rent, maintenance, and ledger in your dashboard.
            </P>
          </div>
        </Surface>

        {/* What's next */}
        <Surface>
          <div style={{ padding: '14px 16px' }}>
            <Eyebrow color={HF.ink3}>What happens next as a tenant</Eyebrow>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                'First rent due August 1 — $964.00',
                'Set up auto-pay → save $10/mo · recapture your application fee',
                'Annual recert each July — we remind you 120 days ahead',
              ].map((line, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <div style={{
                    width: 22, height: 22, borderRadius: HF.r.pill, flex: '0 0 22px',
                    background: HF.accent, color: HF.paper,
                    display: 'grid', placeItems: 'center',
                    fontFamily: HF.display, fontWeight: 800, fontSize: 11,
                  }}>{i + 1}</div>
                  <P size={13}>{line}</P>
                </div>
              ))}
            </div>
          </div>
        </Surface>

        <span data-uh-routed="true"
              onClick={() => window.__UH_GO_TO__ && window.__UH_GO_TO__('tenant-home')}>
          <Button variant="primary" size="lg" full>
            Go to my tenant dashboard
            <Icon name="arrow" size={16} color={HF.paper} style={{ marginLeft: 4 }} />
          </Button>
        </span>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
          <button style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            fontFamily: HF.body, fontSize: 12, fontWeight: 700, color: HF.ink3,
            textDecoration: 'underline',
          }}>Add to calendar</button>
          <button style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            fontFamily: HF.body, fontSize: 12, fontWeight: 700, color: HF.ink3,
            textDecoration: 'underline',
          }}>Share the good news</button>
        </div>
      </div>
    </MobileFrame>
  );
}

Object.assign(window, { V2LeaseSign, V2Walkthrough, V2Utilities, V2Keys });
