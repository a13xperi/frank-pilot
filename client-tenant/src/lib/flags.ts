/**
 * Feature flags — driven by Vite env vars (`VITE_*`).
 * Default: enabled. Explicitly set `VITE_<NAME>=false` to disable.
 *
 * Example:
 *   VITE_PROPERTY_DL2_ENABLED=false  → useFlag('PROPERTY_DL2_ENABLED') === false
 */
export type FlagName = 'PROPERTY_DL2_ENABLED' | 'MOBILE_APPLY_ENABLED';

export function useFlag(name: FlagName): boolean {
  // Vite inlines import.meta.env at build time; safe to read by computed key.
  const meta = import.meta as unknown as { env: Record<string, string | undefined> };
  return meta.env[`VITE_${name}`] !== 'false';
}
