// Stub design tokens — extracted shape from uh-demo/v2/primitives.jsx HF object.
// Lane A's canonical port will replace this file. Keep shape stable.
//
// If you change a key here, coordinate with Lane A — other lanes (B, C, D, E)
// import from this exact path.

export const HF = {
  // surfaces / paper
  paper: '#FFFFFF',
  cream: '#F7F2E8',
  // ink (text)
  ink: '#1F1A12',
  ink2: '#3D352A',
  ink3: '#7A6E5C',
  // accents
  accent: '#C9492A',
  accentLo: '#F8E0D7',
  // semantic
  ok: '#5E7A47',
  okLo: '#E8EFDF',
  warn: '#B8862C',
  warnLo: '#F6EDD5',
  err: '#B0392B',
  sage: '#7A8E69',
  sageLo: '#E6ECDC',
  // border
  border: '#E3DCCB',
  // radii
  r: { sm: 8, md: 12, lg: 16, pill: 999 } as const,
  // shadow
  shadow: {
    xs: '0 1px 2px rgba(31,26,18,0.04)',
    sm: '0 2px 6px rgba(31,26,18,0.08)',
    md: '0 6px 16px rgba(31,26,18,0.12)',
    lg: '0 24px 60px rgba(31,26,18,0.20)',
  },
  // typography
  display: 'ui-serif, "Iowan Old Style", Georgia, serif',
  body: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
} as const;

export type HFTokens = typeof HF;
