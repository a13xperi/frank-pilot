/**
 * Design tokens — minimal local stub for Lane B (welcome).
 *
 * Lane A's canonical `src/styles/tokens.ts` extracts the full `HF` object from
 * `client-tenant/public/uh-demo/v2/primitives.jsx`. This stub mirrors the same
 * shape so Lane B compiles + renders before Lane A merges. On merge, Lane A's
 * version supersedes this file (delete-and-replace, identical exported name).
 *
 * Keep this file in sync with the contract documented in
 * ~/.claude/plans/i-want-to-start-wise-graham.md "Contract 1 — Design tokens".
 */
export const HF = {
  paper: '#fbf9f4',
  cream: '#f6f1e3',
  ink: '#1a1814',
  ink2: '#3d3a34',
  ink3: '#6b6960',
  accent: '#c9492a',
  accentLo: '#fbe5dd',
  border: '#e6dfd0',
  ok: '#3f7a3a',
  okSoft: '#cfe3ca',
  warn: '#9c6a18',
  warnSoft: '#f4e2bf',
  r: {
    sm: '6px',
    md: '10px',
    lg: '14px',
    pill: '999px',
  },
  shadow: {
    sm: '0 1px 2px rgba(0,0,0,0.06)',
    md: '0 4px 12px rgba(0,0,0,0.08)',
    lg: '0 12px 28px rgba(0,0,0,0.12)',
  },
  display: '"Caveat", "Kalam", cursive',
  body: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
} as const;

export type HFTokens = typeof HF;
