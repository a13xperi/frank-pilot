// V2 Hi-Fi primitives — "Zillow for affordable housing, but warmer."
//
// Design system:
//   • Warm whites (#FBF7F0 → #FFFFFF) instead of pure white
//   • Terracotta accent (rooted, friendly, not corporate-blue)
//   • Sage secondary (trust, growth, community)
//   • Deep cocoa text instead of pure black (softer)
//   • Manrope display + Inter body (clean but humanist)
//   • Generous corner radii (12px+) — feels approachable
//   • Photography-led: every property card leads with the image
//   • Subtle shadows, never aggressive

const HF = {
  // ── Neutrals ──────────────────────────────────────────
  cream:    '#FBF7F0',        // page background, warmer than gray
  paper:    '#FFFFFF',        // surfaces
  paperHi:  '#FFFEFB',        // raised surfaces
  border:   '#EBE3D2',        // subtle, warm
  borderHi: '#D9CFB8',
  ink:      '#1F1A12',        // body text — deep cocoa, not black
  ink2:     '#4A4338',
  ink3:     '#807866',
  ink4:     '#B0A892',

  // ── Brand ─────────────────────────────────────────────
  accent:   '#C9492A',        // terracotta — primary action
  accentHi: '#E15C3B',
  accentLo: '#FDF1EC',
  accentInk:'#7A2A18',

  sage:     '#5C7A4F',        // secondary — trust/community
  sageLo:   '#EEF3EA',

  // ── Status ────────────────────────────────────────────
  ok:       '#3F7A3A',
  okLo:     '#EDF5EA',
  warn:     '#9C6A18',
  warnLo:   '#FAF1DB',
  err:      '#A82D1F',
  errLo:    '#FBEDE9',

  // ── Type ──────────────────────────────────────────────
  display:  '"Manrope", -apple-system, system-ui, sans-serif',
  body:     '"Inter", -apple-system, system-ui, sans-serif',
  mono:     '"JetBrains Mono", ui-monospace, monospace',

  // ── Shape ─────────────────────────────────────────────
  r:        { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 },
  shadow:   {
    xs: '0 1px 2px rgba(31, 26, 18, 0.04)',
    sm: '0 2px 8px rgba(31, 26, 18, 0.06), 0 1px 2px rgba(31, 26, 18, 0.04)',
    md: '0 6px 20px rgba(31, 26, 18, 0.08), 0 2px 6px rgba(31, 26, 18, 0.04)',
    lg: '0 16px 40px rgba(31, 26, 18, 0.12), 0 4px 10px rgba(31, 26, 18, 0.06)',
  },
};

// ── Atomic primitives ────────────────────────────────────

function H1({ children, style }) {
  return <h1 style={{ fontFamily: HF.display, fontWeight: 700, fontSize: 36, lineHeight: 1.1, letterSpacing: '-0.02em', color: HF.ink, margin: 0, ...style }}>{children}</h1>;
}
function H2({ children, style }) {
  return <h2 style={{ fontFamily: HF.display, fontWeight: 700, fontSize: 24, lineHeight: 1.2, letterSpacing: '-0.01em', color: HF.ink, margin: 0, ...style }}>{children}</h2>;
}
function H3({ children, style }) {
  return <h3 style={{ fontFamily: HF.display, fontWeight: 600, fontSize: 18, lineHeight: 1.25, color: HF.ink, margin: 0, ...style }}>{children}</h3>;
}
function Eyebrow({ children, color = HF.accent, style }) {
  return <div style={{ fontFamily: HF.body, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color, ...style }}>{children}</div>;
}
function P({ children, size = 14, color = HF.ink2, weight = 400, style }) {
  return <p style={{ fontFamily: HF.body, fontWeight: weight, fontSize: size, lineHeight: 1.5, color, margin: 0, ...style }}>{children}</p>;
}

function Button({ children, variant = 'primary', size = 'md', full, style, onClick }) {
  const sizes = {
    sm: { h: 36, px: 14, fs: 13 },
    md: { h: 44, px: 18, fs: 14 },
    lg: { h: 52, px: 22, fs: 15 },
  };
  const variants = {
    primary:   { bg: HF.accent,  fg: HF.paper, border: HF.accent, shadow: '0 1px 0 rgba(255,255,255,0.2) inset, 0 2px 6px rgba(201, 73, 42, 0.25)' },
    secondary: { bg: HF.paper,   fg: HF.ink,   border: HF.border, shadow: HF.shadow.xs },
    ghost:     { bg: 'transparent', fg: HF.ink, border: 'transparent', shadow: 'none' },
    sage:      { bg: HF.sage,    fg: HF.paper, border: HF.sage,   shadow: '0 2px 6px rgba(92, 122, 79, 0.25)' },
  };
  const v = variants[variant];
  const s = sizes[size];
  return (
    <button onClick={onClick} style={{
      height: s.h, padding: `0 ${s.px}px`,
      background: v.bg, color: v.fg, border: `1px solid ${v.border}`,
      borderRadius: HF.r.md, fontFamily: HF.body, fontWeight: 600, fontSize: s.fs,
      boxShadow: v.shadow, cursor: 'pointer',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      width: full ? '100%' : 'auto',
      transition: 'transform .08s, box-shadow .15s',
      ...style,
    }}>{children}</button>
  );
}

function Chip({ children, active, color = HF.ink, style }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '6px 12px', borderRadius: HF.r.pill,
      background: active ? HF.ink : HF.paper,
      color: active ? HF.paper : color,
      border: `1px solid ${active ? HF.ink : HF.border}`,
      fontFamily: HF.body, fontSize: 13, fontWeight: 500, lineHeight: 1,
      ...style,
    }}>{children}</span>
  );
}

function Tag({ children, tone = 'neutral', style }) {
  const tones = {
    neutral: { bg: HF.cream, fg: HF.ink2, br: HF.border },
    accent:  { bg: HF.accentLo, fg: HF.accentInk, br: '#F3D7CB' },
    sage:    { bg: HF.sageLo, fg: '#3D5535', br: '#D2DDC9' },
    ok:      { bg: HF.okLo, fg: '#2A5527', br: '#CFE1CB' },
    warn:    { bg: HF.warnLo, fg: '#6B4A11', br: '#E8D6A8' },
    err:     { bg: HF.errLo, fg: '#7A2117', br: '#EDCBC4' },
  };
  const t = tones[tone];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '4px 9px', borderRadius: HF.r.sm,
      background: t.bg, color: t.fg, border: `1px solid ${t.br}`,
      fontFamily: HF.body, fontSize: 11, fontWeight: 600, lineHeight: 1.2,
      ...style,
    }}>{children}</span>
  );
}

function Surface({ children, raised, style }) {
  return (
    <div style={{
      background: HF.paper,
      border: `1px solid ${HF.border}`,
      borderRadius: HF.r.lg,
      boxShadow: raised ? HF.shadow.md : HF.shadow.xs,
      overflow: 'hidden',
      ...style,
    }}>{children}</div>
  );
}

// Property image — supports real photo URLs (Unsplash placeholders for now,
// real GPMGLV photography swaps in via the `src` prop later). Falls back to
// the warm gradient + architectural shapes when no src is provided.
function PropertyImage({ ratio = '16 / 10', caption, label, src, style }) {
  return (
    <div style={{
      aspectRatio: ratio, width: '100%', position: 'relative', overflow: 'hidden',
      background: src
        ? `#c4b496 url(${src}) center/cover no-repeat`
        : 'linear-gradient(135deg, #d8c8aa 0%, #c4b496 45%, #a8987a 100%)',
      ...style,
    }}>
      {!src && (
        <svg viewBox="0 0 100 60" preserveAspectRatio="none" style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.18,
        }}>
          <path d="M0 50 L20 30 L40 40 L60 22 L80 32 L100 28 L100 60 L0 60 Z" fill="#5e4f33" />
          <path d="M0 55 L25 48 L45 52 L70 45 L100 50 L100 60 L0 60 Z" fill="#3d3221" />
        </svg>
      )}
      {/* Subtle gradient overlay for text legibility */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(180deg, rgba(31,26,18,0) 60%, rgba(31,26,18,0.55) 100%)',
      }} />
      {label && (
        <span style={{
          position: 'absolute', top: 12, left: 12,
          padding: '5px 11px', borderRadius: HF.r.pill,
          background: 'rgba(255,255,255,0.96)', color: HF.ink,
          fontFamily: HF.body, fontWeight: 600, fontSize: 11,
          boxShadow: HF.shadow.xs,
        }}>{label}</span>
      )}
      {caption && (
        <span style={{
          position: 'absolute', bottom: 10, left: 12, right: 12,
          color: HF.paper, fontFamily: HF.body, fontSize: 11, fontWeight: 500,
          textShadow: '0 1px 2px rgba(0,0,0,0.4)',
        }}>{caption}</span>
      )}
    </div>
  );
}

// Icon component — uses inline SVG paths instead of emoji for consistency.
// Subset of Phosphor Icons (https://phosphoricons.com — MIT licensed) drawn
// inline so we don't need a fetch.
const ICONS = {
  heart:        'M128,224C128,224,32,168,32,104A48,48,0,0,1,128,80,48,48,0,0,1,224,104C224,168,128,224,128,224Z',
  heartFill:    'M178,32c-20.65,0-38.73,8.88-50,23.89C116.73,40.88,98.65,32,78,32A62.07,62.07,0,0,0,16,94c0,70,103.79,126.66,108.21,129a8,8,0,0,0,7.58,0C136.21,220.66,240,164,240,94A62.07,62.07,0,0,0,178,32Z',
  search:       'M229.66,218.34l-50.07-50.06a88.11,88.11,0,1,0-11.31,11.31l50.06,50.07a8,8,0,0,0,11.32-11.32ZM40,112a72,72,0,1,1,72,72A72.08,72.08,0,0,1,40,112Z',
  map:          'M223.45,40.07a8,8,0,0,0-7.52-7.52C139.8,28.08,78.82,51,52.82,94l-6.31-15.78a8,8,0,0,0-8.59-4.95L19.9,79a8,8,0,0,0-6.59,7.92V184a8,8,0,0,0,9.41,7.88l19.94-3.62A192.61,192.61,0,0,1,64,177.43V216a8,8,0,0,0,15.37,3.07L86.65,200H160a8,8,0,0,0,7.79-6.15l9.94-41.66c14.55-14.65,32.78-37.34,38.39-72.61A86.93,86.93,0,0,0,223.45,40.07Z',
  home:         'M218.83,103.77l-80-75.48a1.14,1.14,0,0,1-.11-.11,16,16,0,0,0-21.53,0l-.11.11L37.17,103.77A16,16,0,0,0,32,115.55V208a16,16,0,0,0,16,16H96a16,16,0,0,0,16-16V160h32v48a16,16,0,0,0,16,16h48a16,16,0,0,0,16-16V115.55A16,16,0,0,0,218.83,103.77Z',
  pin:          'M128,16a88.1,88.1,0,0,0-88,88c0,75.3,80,132.17,83.41,134.55a8,8,0,0,0,9.18,0C136,236.17,216,179.3,216,104A88.1,88.1,0,0,0,128,16Zm0,56a32,32,0,1,1-32,32A32,32,0,0,1,128,72Z',
  bed:          'M232,99.06A36.05,36.05,0,0,0,200,80H56V64a8,8,0,0,0-16,0V216a8,8,0,0,0,16,0V184H224v32a8,8,0,0,0,16,0V128A36.13,36.13,0,0,0,232,99.06Zm-152.94,69h0L56,168V152a8,8,0,0,1,8-8H88a8,8,0,0,1,8,8v8.59A30.13,30.13,0,0,1,79.06,168.06ZM112,168v-8a24,24,0,0,0-24-24H64a23.85,23.85,0,0,0-8,1.38V96H200a20,20,0,0,1,20,20v52Z',
  arrow:        'M221.66,133.66l-72,72a8,8,0,0,1-11.32-11.32L196.69,136H40a8,8,0,0,1,0-16H196.69L138.34,61.66a8,8,0,0,1,11.32-11.32l72,72A8,8,0,0,1,221.66,133.66Z',
  arrowLeft:    'M224,128a8,8,0,0,1-8,8H59.31l58.35,58.34a8,8,0,0,1-11.32,11.32l-72-72a8,8,0,0,1,0-11.32l72-72a8,8,0,0,1,11.32,11.32L59.31,120H216A8,8,0,0,1,224,128Z',
  share:        'M232,128a8,8,0,0,1-8,8H183.07a48,48,0,1,1,0-16H224A8,8,0,0,1,232,128ZM72,176a48,48,0,0,1-29.81-10.4l-22.5,22.5a8,8,0,0,1-11.32-11.32l22.5-22.5a48,48,0,1,1,41.13,21.72Z',
  close:        'M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z',
  check:        'M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a8,8,0,0,1,11.32-11.32L96,188.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z',
  warning:      'M236.8,188.09L149.35,36.22a24.76,24.76,0,0,0-42.7,0L19.2,188.09a23.51,23.51,0,0,0,0,23.72A24.35,24.35,0,0,0,40.55,224h174.9a24.35,24.35,0,0,0,21.33-12.19A23.51,23.51,0,0,0,236.8,188.09ZM120,104a8,8,0,0,1,16,0v40a8,8,0,0,1-16,0Zm8,88a12,12,0,1,1,12-12A12,12,0,0,1,128,192Z',
  spark:        'M197.66,114.34l-80-80a8,8,0,0,0-11.32,11.32L181.66,120,106.34,195.34a8,8,0,0,0,11.32,11.32l80-80A8,8,0,0,0,197.66,114.34Z',
  star:         'M239.2,97.29a16,16,0,0,0-13.81-11L166,81.17,142.72,25.81h0a15.95,15.95,0,0,0-29.44,0L90.07,81.17,30.61,86.32a16,16,0,0,0-9.11,28.06L66.61,153.8,53.09,212.34a16,16,0,0,0,23.84,17.34l51-31,51.11,31a16,16,0,0,0,23.84-17.34l-13.52-58.6,45.1-39.36A16,16,0,0,0,239.2,97.29Z',
  bell:         'M221.8,175.94c-5.55-9.56-13.8-36.61-13.8-71.94a80,80,0,1,0-160,0c0,35.34-8.26,62.38-13.81,71.94A16,16,0,0,0,48,200H88.81a40,40,0,0,0,78.38,0H208a16,16,0,0,0,13.8-24.06ZM128,216a24,24,0,0,1-22.62-16h45.24A24,24,0,0,1,128,216Z',
};

function Icon({ name, size = 18, color = 'currentColor', style }) {
  const path = ICONS[name];
  if (!path) return <span style={{ fontSize: size, ...style }}>·</span>;
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" fill={color}
         style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0, ...style }}>
      <path d={path} />
    </svg>
  );
}

window.Icon = Icon;

// Header (top-level navigation)
function AppHeader({ active = 'browse' }) {
  const items = [
    { id: 'browse',  l: 'Browse' },
    { id: 'saved',   l: 'Saved' },
    { id: 'apply',   l: 'My applications' },
    { id: 'help',    l: 'Help' },
  ];
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 24,
      padding: '14px 28px',
      background: HF.paper, borderBottom: `1px solid ${HF.border}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 32, height: 32, borderRadius: HF.r.sm,
          background: HF.accent, color: HF.paper,
          display: 'grid', placeItems: 'center',
          fontFamily: HF.display, fontWeight: 800, fontSize: 15,
        }}>U</div>
        <div style={{ fontFamily: HF.display, fontWeight: 700, fontSize: 16, color: HF.ink, letterSpacing: '-0.01em' }}>
          Universal Housing<span style={{ color: HF.ink3, fontWeight: 500 }}> · Las Vegas</span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 4, marginLeft: 16 }}>
        {items.map(item => (
          <a key={item.id} style={{
            padding: '8px 12px', borderRadius: HF.r.sm,
            fontFamily: HF.body, fontSize: 14, fontWeight: 500,
            color: item.id === active ? HF.ink : HF.ink3,
            background: item.id === active ? HF.cream : 'transparent',
            textDecoration: 'none', cursor: 'pointer',
          }}>{item.l}</a>
        ))}
      </div>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontFamily: HF.body, fontSize: 12, color: HF.ink3 }}>EN | ES</span>
        <Button variant="ghost" size="sm">Sign in</Button>
        <Button variant="primary" size="sm">Apply</Button>
      </div>
    </div>
  );
}

Object.assign(window, {
  HF, H1, H2, H3, Eyebrow, P, Button, Chip, Tag, Surface, PropertyImage, AppHeader,
});
