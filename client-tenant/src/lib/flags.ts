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

export function useFlag(name: FlagName): boolean {
  // Vite inlines import.meta.env at build time; safe to read by computed key.
  const meta = import.meta as unknown as { env: Record<string, string | undefined> };
  const raw = meta.env[`VITE_${name}`];
  if (DEFAULT_OFF.has(name)) return raw === 'true';
  return raw !== 'false';
}
