/**
 * HF design tokens — ported verbatim from
 *   client-tenant/public/uh-demo/v2/primitives.jsx (lines 13–55)
 *
 * "Zillow for affordable housing, but warmer."
 *   • Warm whites (cream → paper) instead of pure white
 *   • Terracotta accent (rooted, friendly, not corporate-blue)
 *   • Sage secondary (trust, growth, community)
 *   • Deep cocoa text instead of pure black (softer)
 *   • Manrope display + Inter body (clean but humanist)
 *   • Generous corner radii (12px+) — feels approachable
 *   • Subtle shadows, never aggressive
 *
 * Source of truth: prototype `HF` object. Do not edit ad hoc — keep in
 * sync with the prototype until BP-00 design-system PR canonicalises.
 */
export const HF = {
  // ── Neutrals ──────────────────────────────────────────
  /** Page background, warmer than gray. Prototype line 15. */
  cream:    '#FBF7F0',
  /** Surfaces (cards, sheets). Prototype line 16. */
  paper:    '#FFFFFF',
  /** Raised surfaces. Prototype line 17. */
  paperHi:  '#FFFEFB',
  /** Subtle, warm borders. Prototype line 18. */
  border:   '#EBE3D2',
  /** Hi-contrast border. Prototype line 19. */
  borderHi: '#D9CFB8',
  /** Body text — deep cocoa, not black. Prototype line 20. */
  ink:      '#1F1A12',
  /** Secondary text. Prototype line 21. */
  ink2:     '#4A4338',
  /** Tertiary text / placeholders. Prototype line 22. */
  ink3:     '#807866',
  /** Disabled text. Prototype line 23. */
  ink4:     '#B0A892',

  // ── Brand ─────────────────────────────────────────────
  /** Terracotta — primary action. Prototype line 26. */
  accent:   '#C9492A',
  /** Terracotta hover. Prototype line 27. */
  accentHi: '#E15C3B',
  /** Terracotta wash (backgrounds). Prototype line 28. */
  accentLo: '#FDF1EC',
  /** Terracotta ink (text on accentLo). Prototype line 29. */
  accentInk:'#7A2A18',

  /** Sage — secondary, trust/community. Prototype line 31. */
  sage:     '#5C7A4F',
  /** Sage wash. Prototype line 32. */
  sageLo:   '#EEF3EA',

  // ── Status ────────────────────────────────────────────
  /** Success. Prototype line 35. */
  ok:       '#3F7A3A',
  /** Success wash. Prototype line 36. */
  okLo:     '#EDF5EA',
  /** Warning. Prototype line 37. */
  warn:     '#9C6A18',
  /** Warning wash. Prototype line 38. */
  warnLo:   '#FAF1DB',
  /** Error. Prototype line 39. */
  err:      '#A82D1F',
  /** Error wash. Prototype line 40. */
  errLo:    '#FBEDE9',

  // ── Type ──────────────────────────────────────────────
  /** Display font family — Manrope. Prototype line 43. */
  display:  '"Manrope", -apple-system, system-ui, sans-serif',
  /** Body font family — Inter. Prototype line 44. */
  body:     '"Inter", -apple-system, system-ui, sans-serif',
  /** Mono — JetBrains. Prototype line 45. */
  mono:     '"JetBrains Mono", ui-monospace, monospace',

  // ── Shape ─────────────────────────────────────────────
  /** Border radii. Prototype line 48. */
  r:        { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 },
  /** Shadow elevations. Prototype lines 49–54. */
  shadow:   {
    xs: '0 1px 2px rgba(31, 26, 18, 0.04)',
    sm: '0 2px 8px rgba(31, 26, 18, 0.06), 0 1px 2px rgba(31, 26, 18, 0.04)',
    md: '0 6px 20px rgba(31, 26, 18, 0.08), 0 2px 6px rgba(31, 26, 18, 0.04)',
    lg: '0 16px 40px rgba(31, 26, 18, 0.12), 0 4px 10px rgba(31, 26, 18, 0.06)',
  },
} as const;

export type HFToken = typeof HF;
