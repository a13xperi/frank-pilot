// V2 Hi-Fi · Browse screen — anchor screen for the new system.
// This is the Zillow-for-affordable-housing landing: search + map peek +
// filter chips + property cards with photography.

function V2Browse() {
  // Real properties from data.jsx
  const properties = PROPS.slice(0, 6);

  return (
    <div style={{
      minHeight: '100vh', background: HF.cream, fontFamily: HF.body, color: HF.ink,
    }}>
      <AppHeader active="browse" />

      {/* Search hero */}
      <div style={{
        background: HF.paper, borderBottom: `1px solid ${HF.border}`,
        padding: '28px 28px 24px',
      }}>
        <div style={{ maxWidth: 1240, margin: '0 auto' }}>
          <Eyebrow>Universal Housing · 16 affordable communities · Las Vegas</Eyebrow>
          <div style={{ height: 6 }} />
          <H1>Find a home that fits your life.</H1>
          <div style={{ height: 6 }} />
          <P size={16} color={HF.ink2} style={{ maxWidth: 580 }}>
            Quality affordable housing across the valley — family, senior, and
            mixed-use communities, all in one search.
          </P>

          {/* Search bar */}
          <div style={{ height: 20 }} />
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 6px 6px 18px', borderRadius: HF.r.lg,
            background: HF.paper, border: `1px solid ${HF.borderHi}`,
            boxShadow: HF.shadow.sm, maxWidth: 720,
          }}>
            <span style={{ fontSize: 18 }}>🔍</span>
            <input
              defaultValue="2 bedroom · Family · East Las Vegas"
              style={{
                flex: 1, border: 'none', outline: 'none', background: 'transparent',
                fontFamily: HF.body, fontSize: 15, color: HF.ink, padding: '10px 0',
              }}
            />
            <Button variant="primary" size="md">Search</Button>
          </div>

          {/* Quick chips */}
          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
            <Chip active>All 16 communities</Chip>
            <Chip>Available now (8)</Chip>
            <Chip>Family</Chip>
            <Chip>Senior 55+</Chip>
            <Chip>Senior 62+</Chip>
            <Chip>Veteran priority</Chip>
            <Chip>Section 8 welcome</Chip>
          </div>
        </div>
      </div>

      {/* Two-column body: results + map */}
      <div style={{
        maxWidth: 1240, margin: '0 auto', padding: '24px 28px 60px',
        display: 'grid', gridTemplateColumns: '1fr 440px', gap: 24,
      }}>
        {/* Results column */}
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
            <H2>16 communities</H2>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <P size={13} color={HF.ink3}>Sort by</P>
              <Chip>Best match ▾</Chip>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {properties.map((p, i) => (
              <Surface key={i} raised={i === 0}>
                <div style={{ position: 'relative' }}>
                  <PropertyImage
                    ratio="16 / 10"
                    src={p.photo}
                    label={p.vacancy > 0 ? `${p.vacancy} units available` : `${p.waitlistMo}-mo waitlist`}
                  />
                  <button style={{
                    position: 'absolute', top: 12, right: 12,
                    width: 36, height: 36, borderRadius: HF.r.pill,
                    background: 'rgba(255,255,255,0.95)', border: 'none',
                    cursor: 'pointer', boxShadow: HF.shadow.xs,
                    display: 'grid', placeItems: 'center',
                    color: i === 0 ? HF.accent : HF.ink2,
                  }}>
                    <Icon name={i === 0 ? 'heartFill' : 'heart'} size={18} color={i === 0 ? HF.accent : HF.ink2} />
                  </button>
                </div>

                <div style={{ padding: '14px 16px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                    <H3 style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.name}
                    </H3>
                  </div>
                  <P size={13} color={HF.ink3} style={{ marginTop: 2 }}>{p.neighborhood}</P>

                  <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                    <Tag tone={p.type === 'Veteran' ? 'accent' : p.type.startsWith('Senior') ? 'sage' : 'neutral'}>
                      {p.type}
                    </Tag>
                    <Tag tone="neutral">{p.beds}</Tag>
                    {p.vacancy > 0 && <Tag tone="ok">● Available now</Tag>}
                    {p.vacancy === 0 && <Tag tone="warn">● Waitlist {p.waitlistMo}mo</Tag>}
                  </div>

                  <div style={{
                    marginTop: 12, paddingTop: 12, borderTop: `1px solid ${HF.border}`,
                    display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                  }}>
                    <div>
                      <span style={{ fontFamily: HF.display, fontWeight: 700, fontSize: 18, color: HF.ink }}>
                        {p.rentRange}
                      </span>
                      <span style={{ fontFamily: HF.body, fontSize: 12, color: HF.ink3, marginLeft: 4 }}>/ mo</span>
                    </div>
                    <P size={12} color={HF.ink3}>{p.sqftRange} sq ft · 🚶 {p.walk}</P>
                  </div>
                </div>
              </Surface>
            ))}
          </div>
        </div>

        {/* Map column (sticky) */}
        <div style={{ position: 'sticky', top: 24, alignSelf: 'start' }}>
          <Surface raised style={{ overflow: 'hidden' }}>
            <div style={{
              height: 460, position: 'relative',
              background: 'linear-gradient(135deg, #e6ddc8 0%, #ddd2b8 50%, #d0c4a6 100%)',
            }}>
              {/* Roads */}
              <svg viewBox="0 0 440 460" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
                <g stroke="rgba(255,255,255,0.4)" fill="none" strokeWidth="3">
                  <path d="M0 120 Q 100 100 220 130 T 440 110" />
                  <path d="M0 260 L 440 240" />
                  <path d="M120 0 Q 130 200 110 460" />
                  <path d="M310 0 L 320 460" />
                  <path d="M0 380 Q 150 400 280 360 T 440 380" />
                </g>
                <g stroke="rgba(255,255,255,0.2)" fill="none" strokeWidth="1.5">
                  <path d="M0 180 L 440 175" />
                  <path d="M0 320 L 440 315" />
                  <path d="M70 0 L 75 460" />
                  <path d="M220 0 Q 225 230 220 460" />
                </g>
              </svg>
              {/* Pins */}
              {[
                { x: 60, y: 100, ok: true,  count: '$612' },
                { x: 140, y: 180, ok: false },
                { x: 200, y: 90, ok: true,   count: '$725', primary: true },
                { x: 270, y: 220, ok: false },
                { x: 110, y: 280, ok: true,  count: '$680' },
                { x: 320, y: 140, ok: false },
                { x: 180, y: 320, ok: true,  count: '$655' },
                { x: 360, y: 280, ok: false },
                { x: 250, y: 380, ok: false },
                { x: 90, y: 380, ok: false },
                { x: 380, y: 200, ok: true,  count: '$760' },
                { x: 30, y: 220, ok: false },
              ].map((p, i) => p.count ? (
                <div key={i} style={{
                  position: 'absolute', left: `${(p.x / 440) * 100}%`, top: `${(p.y / 460) * 100}%`,
                  transform: 'translate(-50%, -100%)',
                  padding: '5px 10px', borderRadius: HF.r.pill,
                  background: p.primary ? HF.accent : HF.paper,
                  color: p.primary ? HF.paper : HF.ink,
                  border: `2px solid ${p.primary ? HF.accent : HF.paper}`,
                  fontFamily: HF.body, fontWeight: 700, fontSize: 12,
                  boxShadow: HF.shadow.md, whiteSpace: 'nowrap',
                  cursor: 'pointer',
                }}>{p.count}</div>
              ) : (
                <div key={i} style={{
                  position: 'absolute', left: `${(p.x / 440) * 100}%`, top: `${(p.y / 460) * 100}%`,
                  transform: 'translate(-50%, -50%)',
                  width: 14, height: 14, borderRadius: HF.r.pill,
                  background: HF.warn, border: `2.5px solid ${HF.paper}`,
                  boxShadow: HF.shadow.sm,
                }} />
              ))}
              {/* Map controls */}
              <div style={{
                position: 'absolute', top: 12, right: 12, display: 'flex', flexDirection: 'column',
                background: HF.paper, borderRadius: HF.r.sm, overflow: 'hidden',
                boxShadow: HF.shadow.sm,
              }}>
                <button style={{ width: 36, height: 36, border: 'none', background: HF.paper, fontSize: 16, cursor: 'pointer', borderBottom: `1px solid ${HF.border}` }}>+</button>
                <button style={{ width: 36, height: 36, border: 'none', background: HF.paper, fontSize: 16, cursor: 'pointer' }}>−</button>
              </div>
              <div style={{
                position: 'absolute', bottom: 12, left: 12,
                padding: '6px 12px', borderRadius: HF.r.pill,
                background: HF.paper, boxShadow: HF.shadow.sm,
                fontFamily: HF.body, fontSize: 12, fontWeight: 500, color: HF.ink2,
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span style={{ width: 8, height: 8, borderRadius: 99, background: HF.ok }} />
                Available now
                <span style={{ width: 8, height: 8, borderRadius: 99, background: HF.warn, marginLeft: 4 }} />
                Waitlist
              </div>
            </div>
          </Surface>

          <div style={{ height: 14 }} />
          <Surface>
            <div style={{ padding: '14px 16px' }}>
              <Eyebrow color={HF.sage}>● Live · 32 minutes ago</Eyebrow>
              <div style={{ height: 6 }} />
              <H3>3 new openings this week</H3>
              <P size={13} color={HF.ink2} style={{ marginTop: 4 }}>
                We'll email you when units matching your criteria come online.
              </P>
              <div style={{ height: 10 }} />
              <Button variant="secondary" size="sm">Set up alerts</Button>
            </div>
          </Surface>
        </div>
      </div>
    </div>
  );
}

window.V2Browse = V2Browse;
