// V2 Hi-Fi · Mobile Property Detail — the Zillow-style PDP, mobile-led.
//
// Big hero image with gallery dots, sticky save heart, key facts band,
// Zillow-style facts grid, livability scores card, eligibility callout,
// floor plans (matched unit + others), neighborhood snippet, sticky apply CTA.

// Mobile frame — 390 × scrollable, with a status bar + soft bezel.
// In phone-native mode (window.__UH_PHONE_NATIVE__ === true), renders the
// inner content full-bleed with no bezel and no status bar (the real phone
// provides one), so the screen looks native when opened on an actual phone.
function MobileFrame({ children, label, h = 1800 }) {
  if (typeof window !== 'undefined' && window.__UH_PHONE_NATIVE__) {
    return (
      <div style={{
        width: '100%', minHeight: '100vh', background: HF.cream,
        overflow: 'visible', position: 'relative',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}>{children}</div>
    );
  }
  return (
    <div style={{
      width: 408, padding: 9, background: '#1F1A12', borderRadius: 48,
      boxShadow: '0 24px 60px rgba(31,26,18,0.35)',
      position: 'relative',
    }}>
      <div style={{
        position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
        width: 110, height: 26, borderRadius: 20, background: '#0a0805', zIndex: 10,
      }} />
      <div style={{
        width: 390, height: h, background: HF.cream,
        borderRadius: 40, overflow: 'hidden', position: 'relative',
      }}>
        {/* Status bar */}
        <div style={{
          height: 44, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 28px 0 32px', fontFamily: HF.body, fontSize: 14, fontWeight: 600, color: HF.ink,
          position: 'relative', zIndex: 5,
        }}>
          <span>9:41</span>
          <span style={{ letterSpacing: 2, fontSize: 12 }}>●●●●● 5G ▮</span>
        </div>
        <div style={{ height: h - 44, overflow: 'auto', position: 'relative' }}>
          {children}
        </div>
      </div>
      {label && (
        <div style={{
          position: 'absolute', left: 0, right: 0, bottom: -22,
          textAlign: 'center', color: HF.ink3, fontFamily: HF.body, fontSize: 11, fontWeight: 500,
        }}>{label}</div>
      )}
    </div>
  );
}

function V2PropertyDetail() {
  // Marisol's property — Juan Garcia (waitlisted 2BR family in East LV)
  const p = propBySlug('juan-garcia');
  const bed = '2BR';
  return (
    <MobileFrame label={`Property detail · ${p.name.split(' ').slice(0, 2).join(' ')}`}>
      {/* Hero gallery */}
      <div style={{ position: 'relative' }}>
        <div style={{ position: 'relative' }}>
          <PropertyImage ratio="4 / 3" src={p.photo} caption="building exterior · 1 / 12" />
          {/* Top bar overlays */}
          <div style={{
            position: 'absolute', top: 14, left: 16, right: 16,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <button style={{
              width: 38, height: 38, borderRadius: HF.r.pill,
              background: 'rgba(255,255,255,0.95)', border: 'none', cursor: 'pointer',
              boxShadow: HF.shadow.sm, fontSize: 18, color: HF.ink,
              display: 'grid', placeItems: 'center',
            }}>←</button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={{
                width: 38, height: 38, borderRadius: HF.r.pill,
                background: 'rgba(255,255,255,0.95)', border: 'none', cursor: 'pointer',
                boxShadow: HF.shadow.sm, fontSize: 16, color: HF.ink,
                display: 'grid', placeItems: 'center',
              }}>↗</button>
              <button style={{
                width: 38, height: 38, borderRadius: HF.r.pill,
                background: 'rgba(255,255,255,0.95)', border: 'none', cursor: 'pointer',
                boxShadow: HF.shadow.sm, fontSize: 18, color: HF.accent,
                display: 'grid', placeItems: 'center',
              }}>♥</button>
            </div>
          </div>
          {/* Bottom dots + gallery counter */}
          <div style={{
            position: 'absolute', bottom: 14, left: '50%', transform: 'translateX(-50%)',
            display: 'flex', gap: 5,
          }}>
            {[1, 2, 3, 4, 5].map(n => (
              <span key={n} style={{
                width: n === 1 ? 22 : 6, height: 6, borderRadius: 99,
                background: n === 1 ? HF.paper : 'rgba(255,255,255,0.55)',
              }} />
            ))}
          </div>
          <div style={{
            position: 'absolute', bottom: 14, right: 16,
            padding: '4px 10px', borderRadius: HF.r.pill,
            background: 'rgba(31,26,18,0.65)', color: HF.paper,
            fontFamily: HF.body, fontSize: 11, fontWeight: 600,
          }}>1 / 12</div>
        </div>
      </div>

      <div style={{ padding: '20px 20px 100px' }}>
        {/* Rent + headline */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div>
            <span style={{ fontFamily: HF.display, fontSize: 28, fontWeight: 800, color: HF.ink, letterSpacing: '-0.02em' }}>
              ${p.rentRange.split('–')[0].replace('$','')}
            </span>
            <span style={{ fontFamily: HF.body, fontSize: 14, color: HF.ink3 }}>–{p.rentRange.split('–')[1]}/mo</span>
          </div>
          <Tag tone="warn">● Waitlist · ~{p.waitlistMo}mo</Tag>
        </div>

        <div style={{ height: 6 }} />
        <H2 style={{ fontSize: 22 }}>{p.name}</H2>
        <P size={14} color={HF.ink3} style={{ marginTop: 4 }}>
          {p.address.replace(/, Las Vegas.*/,'').replace(/, North Las Vegas.*/,'').replace(/, Henderson.*/,'')} · {p.neighborhood}
        </P>

        {/* Key facts band — Zillow's iconic bed/bath/sqft row */}
        <div style={{
          display: 'flex', gap: 0, marginTop: 18,
          padding: '14px 0', borderTop: `1px solid ${HF.border}`, borderBottom: `1px solid ${HF.border}`,
        }}>
          {[
            { v: '1–3', l: 'beds' },
            { v: '1–2', l: 'baths' },
            { v: '680–1,150', l: 'sq ft' },
            { v: 'Family', l: 'community' },
          ].map((f, i, arr) => (
            <div key={i} style={{
              flex: 1, textAlign: 'center',
              borderRight: i < arr.length - 1 ? `1px solid ${HF.border}` : 'none',
            }}>
              <div style={{ fontFamily: HF.display, fontWeight: 700, fontSize: 15, color: HF.ink }}>
                {f.v}
              </div>
              <div style={{ fontFamily: HF.body, fontSize: 11, color: HF.ink3, marginTop: 2 }}>
                {f.l}
              </div>
            </div>
          ))}
        </div>

        {/* Marketplace status — primary action driver */}
        <div style={{
          marginTop: 18, padding: 16, borderRadius: HF.r.lg,
          background: HF.warnLo, border: `1px solid #E8D6A8`,
        }}>
          <Eyebrow color="#6B4A11">Your spot · 2BR list</Eyebrow>
          <div style={{ height: 6 }} />
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <div>
              <span style={{ fontFamily: HF.display, fontWeight: 800, fontSize: 28, color: '#6B4A11' }}>#12</span>
              <span style={{ fontFamily: HF.body, fontSize: 13, color: '#6B4A11', marginLeft: 6 }}>
                of 38 in queue
              </span>
            </div>
            <Tag tone="ok">↑ 3 spots this month</Tag>
          </div>
          <P size={13} color={HF.ink2} style={{ marginTop: 8 }}>
            Estimated wait: <b>3–6 months</b>. Faster-list options below.
          </P>
        </div>

        {/* About */}
        <div style={{ marginTop: 22 }}>
          <H3>About this community</H3>
          <div style={{ height: 8 }} />
          <P size={14} color={HF.ink2}>
            Family-oriented community in East Las Vegas, walking distance to
            Garcia Elementary and Sunrise Hospital. Three-story building with
            elevator, on-site laundry, gated parking, and a courtyard with
            playground equipment. Section 8 vouchers welcome.
          </P>
          <button style={{
            background: 'transparent', border: 'none', padding: 0, marginTop: 8,
            fontFamily: HF.body, fontSize: 14, fontWeight: 600, color: HF.accent, cursor: 'pointer',
          }}>Read more ▾</button>
        </div>

        {/* Eligibility */}
        <div style={{ marginTop: 22 }}>
          <H3>Who can apply</H3>
          <div style={{ height: 10 }} />
          <Surface style={{ background: HF.sageLo, borderColor: '#D2DDC9' }}>
            <div style={{ padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  width: 28, height: 28, borderRadius: HF.r.pill, background: HF.sage, color: HF.paper,
                  display: 'grid', placeItems: 'center', fontSize: 14, fontWeight: 700,
                }}>✓</span>
                <div style={{ flex: 1 }}>
                  <P size={13} color="#3D5535" weight={600}>You meet the requirements</P>
                  <P size={11} color={HF.ink3}>Family · 1–4 bedroom · all incomes welcome under 60% AMI</P>
                </div>
              </div>
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid #D2DDC9` }}>
                {[
                  'Open to all household sizes',
                  'All adult HH members must apply',
                  'Section 8 vouchers welcome',
                  'Income limit: $42,150/yr for 4-person HH (50% AMI)',
                ].map((line, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 6 }}>
                    <span style={{ color: HF.sage, fontSize: 12, marginTop: 2 }}>✓</span>
                    <P size={13} color={HF.ink2}>{line}</P>
                  </div>
                ))}
              </div>
            </div>
          </Surface>
        </div>

        {/* Floor plans / unit mix */}
        <div style={{ marginTop: 22 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <H3>Floor plans</H3>
            <P size={12} color={HF.ink3}>3 layouts</P>
          </div>
          <div style={{ height: 10 }} />
          {[
            { bed: '1BR', sqft: '680', rent: '$740', view: 'Greenery', floor: '1', primary: false, waitMo: 1 },
            { bed: '2BR', sqft: '905', rent: '$920', view: 'Greenery', floor: '2', primary: true,  waitMo: 4 },
            { bed: '3BR', sqft: '1,150', rent: '$1,180', view: 'City', floor: '3', primary: false, waitMo: 0 },
          ].map((u, i) => (
            <Surface key={i} style={{
              marginTop: 8,
              borderColor: u.primary ? HF.accent : HF.border,
              boxShadow: u.primary ? '0 0 0 1px rgba(201, 73, 42, 0.35)' : HF.shadow.xs,
            }}>
              <div style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
                {/* Floor plan thumb */}
                <div style={{
                  width: 64, height: 64, borderRadius: HF.r.md, flex: '0 0 64px',
                  background: u.primary ? HF.accentLo : HF.cream,
                  border: `1px solid ${u.primary ? '#F3D7CB' : HF.border}`,
                  display: 'grid', placeItems: 'center',
                }}>
                  <svg width="40" height="40" viewBox="0 0 40 40">
                    <g stroke={u.primary ? HF.accent : HF.ink3} strokeWidth="1.5" fill="none">
                      <rect x="4" y="4" width="32" height="32" />
                      <line x1="20" y1="4" x2="20" y2="20" />
                      <line x1="4" y1="20" x2="20" y2="20" />
                      <line x1="20" y1="14" x2="36" y2="14" />
                    </g>
                  </svg>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                      <H3 style={{ fontSize: 16 }}>{u.bed}</H3>
                      {u.primary && <Tag tone="accent">Your unit</Tag>}
                    </div>
                    <span style={{ fontFamily: HF.display, fontWeight: 700, fontSize: 16 }}>{u.rent}</span>
                  </div>
                  <P size={12} color={HF.ink3} style={{ marginTop: 2 }}>
                    {u.sqft} sq ft · floor {u.floor} · {u.view} view
                  </P>
                  <div style={{ marginTop: 6 }}>
                    {u.waitMo === 0
                      ? <Tag tone="ok">● Available now</Tag>
                      : <Tag tone="warn">● Waitlist · ~{u.waitMo}mo</Tag>}
                  </div>
                </div>
              </div>
            </Surface>
          ))}
        </div>

        {/* Livability */}
        <div style={{ marginTop: 22 }}>
          <H3>What's around</H3>
          <div style={{ height: 10 }} />
          <Surface>
            <div style={{ padding: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                {[
                  { v: 78, l: 'Walk', s: 'Very walkable' },
                  { v: 70, l: 'Transit', s: 'Bus / rail' },
                  { v: 65, l: 'Quiet', s: 'Low noise' },
                ].map((sc, i) => (
                  <div key={i} style={{ textAlign: 'center' }}>
                    <div style={{
                      width: 56, height: 56, borderRadius: HF.r.pill, margin: '0 auto',
                      border: `3px solid ${sc.v >= 75 ? HF.ok : sc.v >= 55 ? HF.warn : HF.err}`,
                      display: 'grid', placeItems: 'center',
                      background: HF.paper,
                    }}>
                      <span style={{
                        fontFamily: HF.display, fontWeight: 800, fontSize: 18,
                        color: sc.v >= 75 ? HF.ok : sc.v >= 55 ? HF.warn : HF.err,
                      }}>{sc.v}</span>
                    </div>
                    <div style={{ marginTop: 6 }}>
                      <P size={13} weight={600} color={HF.ink}>{sc.l}</P>
                      <P size={11} color={HF.ink3}>{sc.s}</P>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${HF.border}` }}>
                <Eyebrow color={HF.ink3}>Nearby</Eyebrow>
                <div style={{ marginTop: 6, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {[
                    { icon: '🛒', l: 'Grocery',   v: '0.2 mi', close: true },
                    { icon: '🏥', l: 'Healthcare', v: '0.6 mi' },
                    { icon: '🌳', l: 'Park',       v: '0.1 mi', close: true },
                    { icon: '🏫', l: 'School',     v: '0.4 mi', close: true },
                  ].map((n, i) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '8px 10px', borderRadius: HF.r.sm,
                      background: n.close ? HF.okLo : HF.cream,
                      border: `1px solid ${n.close ? '#CFE1CB' : HF.border}`,
                    }}>
                      <span style={{ fontSize: 14 }}>{n.icon}</span>
                      <span style={{ flex: 1, fontFamily: HF.body, fontSize: 12, fontWeight: 500, color: HF.ink2 }}>
                        {n.l}
                      </span>
                      <span style={{ fontFamily: HF.display, fontWeight: 700, fontSize: 13, color: n.close ? HF.ok : HF.ink }}>
                        {n.v}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Surface>
        </div>

        {/* Amenities */}
        <div style={{ marginTop: 22 }}>
          <H3>Amenities</H3>
          <div style={{ height: 10 }} />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[
              '🏊 Pool', '🛗 Elevator', '🧺 Laundry', '❄ A/C', '🚗 Gated parking',
              '🌳 Courtyard', '🎮 Playground', '♿ Accessible units',
            ].map((a, i) => (
              <span key={i} style={{
                padding: '8px 12px', borderRadius: HF.r.pill,
                background: HF.paper, border: `1px solid ${HF.border}`,
                fontFamily: HF.body, fontSize: 13, fontWeight: 500, color: HF.ink2,
              }}>{a}</span>
            ))}
          </div>
        </div>
      </div>

      {/* Sticky bottom CTA */}
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        background: HF.paper, borderTop: `1px solid ${HF.border}`,
        padding: '14px 20px 24px', display: 'flex', gap: 10,
      }}>
        <Button variant="secondary" size="lg" style={{ flex: '0 0 auto', width: 56, padding: 0 }}>
          <span style={{ fontSize: 18, color: HF.accent }}>♥</span>
        </Button>
        <span data-uh-routed="true" style={{ flex: 1 }}
              onClick={() => window.__UH_GO_TO__ && window.__UH_GO_TO__('apply-1')}>
          <Button variant="primary" size="lg" full>
            Apply for this home →
          </Button>
        </span>
      </div>
    </MobileFrame>
  );
}

window.V2PropertyDetail = V2PropertyDetail;
window.MobileFrame = MobileFrame;
