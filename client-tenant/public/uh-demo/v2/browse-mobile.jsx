// V2 Hi-Fi · Mobile Browse — Zillow-style mobile search experience.
// Top header, search bar, filter chips, sticky map peek, photo-led property
// cards with save heart, eligibility tags, vacancy badges, rent.

function V2BrowseMobile() {
  // Real properties from data.jsx — display 4 for Marisol's family/2BR search
  // (filtered + sorted: her saved property first, then nearby family options)
  const featured = [
    propBySlug('juan-garcia'),     // her #1 pick · waitlist
    propBySlug('fletcher'),         // available now alternate
    propBySlug('sarann-knight'),    // family · waitlist
    propBySlug('donna-louise'),     // mixed-use · waitlist
  ];
  const savedSlugs = ['juan-garcia', 'donna-louise'];

  return (
    <MobileFrame label="Mobile · browse 16 communities" h={1900}>
      {/* Header */}
      <div style={{ padding: '8px 20px 16px', background: HF.paper, borderBottom: `1px solid ${HF.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <div style={{
            width: 32, height: 32, borderRadius: HF.r.sm, background: HF.accent, color: HF.paper,
            display: 'grid', placeItems: 'center',
            fontFamily: HF.display, fontWeight: 800, fontSize: 15,
          }}>U</div>
          <div style={{ flex: 1, fontFamily: HF.display, fontWeight: 700, fontSize: 15 }}>Universal Housing</div>
          <span style={{ fontFamily: HF.body, fontSize: 11, color: HF.ink3, fontWeight: 500 }}>EN | ES</span>
          <div style={{
            width: 32, height: 32, borderRadius: HF.r.pill, background: HF.cream,
            border: `1px solid ${HF.border}`, display: 'grid', placeItems: 'center',
            fontSize: 14, color: HF.ink,
          }}>M</div>
        </div>

        {/* Search bar */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '0 14px', height: 48, borderRadius: HF.r.md,
          background: HF.paper, border: `1px solid ${HF.borderHi}`,
          boxShadow: HF.shadow.xs,
        }}>
          <span style={{ fontSize: 16 }}>🔍</span>
          <div style={{ flex: 1, fontFamily: HF.body, fontSize: 14, color: HF.ink, fontWeight: 500 }}>
            2BR · Family · East LV
          </div>
          <span style={{
            padding: '3px 8px', borderRadius: HF.r.sm,
            background: HF.accentLo, color: HF.accent,
            fontFamily: HF.body, fontSize: 11, fontWeight: 700,
          }}>16</span>
        </div>

        {/* Filter chips */}
        <div style={{
          display: 'flex', gap: 6, marginTop: 12, overflowX: 'auto',
        }}>
          <Chip active>16 communities</Chip>
          <Chip>Available (8)</Chip>
          <Chip>Family</Chip>
          <Chip>Senior 55+</Chip>
          <Chip>Veteran</Chip>
        </div>
      </div>

      {/* Map peek */}
      <div style={{ padding: '14px 20px 0' }}>
        <Surface style={{ overflow: 'hidden' }}>
          <div style={{
            height: 180, position: 'relative',
            background: 'linear-gradient(135deg, #e6ddc8 0%, #ddd2b8 50%, #d0c4a6 100%)',
          }}>
            <svg viewBox="0 0 360 180" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
              <g stroke="rgba(255,255,255,0.4)" fill="none" strokeWidth="2.5">
                <path d="M0 60 Q 80 50 180 65 T 360 55" />
                <path d="M0 130 L 360 120" />
                <path d="M90 0 Q 100 90 80 180" />
                <path d="M260 0 L 270 180" />
              </g>
            </svg>
            {[
              { x: 50, y: 50, primary: true, label: '$740' },
              { x: 140, y: 80, label: '$725' },
              { x: 220, y: 60 },
              { x: 280, y: 110 },
              { x: 100, y: 130 },
              { x: 200, y: 140 },
              { x: 320, y: 80 },
              { x: 60, y: 90 },
            ].map((p, i) => p.label ? (
              <div key={i} style={{
                position: 'absolute', left: `${(p.x / 360) * 100}%`, top: `${(p.y / 180) * 100}%`,
                transform: 'translate(-50%, -100%)',
                padding: '4px 9px', borderRadius: HF.r.pill,
                background: p.primary ? HF.accent : HF.paper,
                color: p.primary ? HF.paper : HF.ink,
                border: `2px solid ${p.primary ? HF.accent : HF.paper}`,
                fontFamily: HF.body, fontWeight: 700, fontSize: 11, whiteSpace: 'nowrap',
                boxShadow: HF.shadow.md,
              }}>{p.label}</div>
            ) : (
              <div key={i} style={{
                position: 'absolute', left: `${(p.x / 360) * 100}%`, top: `${(p.y / 180) * 100}%`,
                transform: 'translate(-50%, -50%)',
                width: 12, height: 12, borderRadius: HF.r.pill,
                background: HF.warn, border: `2px solid ${HF.paper}`,
                boxShadow: HF.shadow.xs,
              }} />
            ))}
            <button style={{
              position: 'absolute', bottom: 12, right: 12,
              padding: '7px 12px', borderRadius: HF.r.pill,
              background: HF.ink, color: HF.paper, border: 'none',
              fontFamily: HF.body, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              boxShadow: HF.shadow.md,
            }}>Open map ↗</button>
          </div>
        </Surface>
      </div>

      {/* Results header */}
      <div style={{
        padding: '20px 20px 12px',
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
      }}>
        <H2 style={{ fontSize: 20 }}>16 communities</H2>
        <P size={13} color={HF.ink3} weight={500}>Best match ▾</P>
      </div>

      {/* Property cards */}
      <div style={{ padding: '0 20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {featured.map((p, i) => {
          const saved = savedSlugs.includes(p.slug);
          return (
          <Surface key={i} raised={i === 0}>
            <div style={{ position: 'relative' }}>
              <PropertyImage
                ratio="16 / 10"
                src={p.photo}
                label={p.vacancy > 0 ? `${p.vacancy} units now` : `${p.waitlistMo}-mo wait`}
              />
              <button style={{
                position: 'absolute', top: 10, right: 10,
                width: 36, height: 36, borderRadius: HF.r.pill,
                background: 'rgba(255,255,255,0.96)', border: 'none',
                cursor: 'pointer', boxShadow: HF.shadow.sm,
                display: 'grid', placeItems: 'center',
                color: saved ? HF.accent : HF.ink2,
              }}>
                <Icon name={saved ? 'heartFill' : 'heart'} size={18} color={saved ? HF.accent : HF.ink2} />
              </button>
              {/* Photo count */}
              <div style={{
                position: 'absolute', bottom: 10, right: 10,
                padding: '3px 8px', borderRadius: HF.r.sm,
                background: 'rgba(31,26,18,0.7)', color: HF.paper,
                fontFamily: HF.body, fontSize: 11, fontWeight: 600,
                display: 'inline-flex', alignItems: 'center', gap: 4,
              }}>📷 12</div>
            </div>

            <div style={{ padding: '14px 16px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontFamily: HF.display, fontSize: 20, fontWeight: 800, color: HF.ink, letterSpacing: '-0.01em' }}>
                    ${p.rentRange.split('–')[0].replace('$','')}
                  </span>
                  <span style={{ fontFamily: HF.body, fontSize: 12, color: HF.ink3, marginLeft: 4 }}>+/mo</span>
                </div>
                <Tag tone={p.vacancy > 0 ? 'ok' : 'warn'}>
                  ● {p.vacancy > 0 ? 'Now' : `${p.waitlistMo}mo`}
                </Tag>
              </div>
              <H3 style={{ fontSize: 15, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.name}
              </H3>
              <P size={13} color={HF.ink3} style={{ marginTop: 2 }}>
                {p.beds} · {p.neighborhood} · 🚶 {p.walk}
              </P>
              <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                <Tag tone={p.type === 'Veteran' ? 'accent' : p.type.startsWith('Senior') ? 'sage' : 'neutral'}>
                  {p.type}
                </Tag>
                {saved && <Tag tone="accent">♥ Saved</Tag>}
              </div>
            </div>
          </Surface>
          );
        })}

        {/* Load-more */}
        <Button variant="secondary" size="md" full>
          See 12 more communities
        </Button>
      </div>

      {/* Sticky bottom bar */}
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        background: HF.paper, borderTop: `1px solid ${HF.border}`,
        padding: '10px 20px 24px',
        display: 'flex', justifyContent: 'space-around', alignItems: 'center',
      }}>
        {[
          { icon: '🔍', l: 'Browse', active: true },
          { icon: '♥',  l: 'Saved' },
          { icon: '📋', l: 'My apps' },
          { icon: '💬', l: 'Help' },
        ].map((tab, i) => (
          <div key={i} style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
            color: tab.active ? HF.accent : HF.ink3,
          }}>
            <span style={{ fontSize: 18, filter: tab.active ? 'none' : 'grayscale(1)' }}>{tab.icon}</span>
            <span style={{ fontFamily: HF.body, fontSize: 10, fontWeight: tab.active ? 700 : 500 }}>
              {tab.l}
            </span>
          </div>
        ))}
      </div>
    </MobileFrame>
  );
}

window.V2BrowseMobile = V2BrowseMobile;
