/**
 * Feature flags — driven by Vite env vars (`VITE_*`).
 *
 * Convention:
 *   - Most flags default ENABLED. Set `VITE_<NAME>=false` to disable.
 *   - `PAYMENT_WIZARD_ENABLED` defaults DISABLED (opt-in via `=true`)
 *     because the wizard is in active integration (BP-03b Lane W).
 */
export type FlagName =
  | 'PROPERTY_DL2_ENABLED'
  | 'MOBILE_APPLY_ENABLED'
  | 'PAYMENT_WIZARD_ENABLED';

// Flags that default OFF (opt-in via `=true`).
const DEFAULT_OFF: ReadonlySet<FlagName> = new Set(['PAYMENT_WIZARD_ENABLED']);

// Static lookup — Vite's `define` plugin can only substitute literal property
// access on `import.meta.env.VITE_*`. Computed-key access (`env[`VITE_${name}`]`)
// is left as a runtime expression, and the browser's native `import.meta.env`
// is `undefined`, so every flag silently pinned to its default. See PR fixing
// this for the empirical bundle-grep evidence.
const ENV_RAW: Readonly<Record<FlagName, string | undefined>> = {
  PROPERTY_DL2_ENABLED: import.meta.env.VITE_PROPERTY_DL2_ENABLED,
  MOBILE_APPLY_ENABLED: import.meta.env.VITE_MOBILE_APPLY_ENABLED,
  PAYMENT_WIZARD_ENABLED: import.meta.env.VITE_PAYMENT_WIZARD_ENABLED,
};

export function useFlag(name: FlagName): boolean {
  // Trim whitespace — the Vercel CLI's `echo "true" | vercel env add` flow
  // stores values with a trailing newline. Without `.trim()`, "true\n" !==
  // "true" and a default-off flag would stay pinned OFF even when explicitly
  // set to true in the dashboard.
  const raw = ENV_RAW[name]?.trim();
  if (DEFAULT_OFF.has(name)) return raw === 'true';
  return raw !== 'false';
}
