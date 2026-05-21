/**
 * Lane E local stub of Lane A's design tokens (BP-00 substrate).
 *
 * When Lane A merges its canonical `src/styles/tokens.ts`, this file is
 * either replaced (preferred) or deleted in favor of the canonical export.
 * Until then we ship a minimum-viable shape mirroring `HF` from
 * `client-tenant/public/uh-demo/v2/primitives.jsx`.
 */
export const HF = {
  paper: "#FFFFFF",
  cream: "#FAF7F2",
  ink: "#0F1419",
  ink2: "#3A4452",
  ink3: "#6B7785",
  accent: "#059669", // emerald-600 to match existing brand
  accentLo: "#D1FAE5",
  border: "#E5E7EB",
  r: { sm: "0.375rem", md: "0.5rem", lg: "0.75rem", pill: "9999px" },
  shadow: {
    sm: "0 1px 2px rgba(15,20,25,0.05)",
    md: "0 4px 6px -1px rgba(15,20,25,0.10)",
    lg: "0 10px 15px -3px rgba(15,20,25,0.10)",
  },
  display: "ui-serif, Georgia, 'Times New Roman', serif",
  body: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
} as const;

export type HFTokens = typeof HF;
