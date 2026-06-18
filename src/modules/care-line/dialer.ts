/**
 * Care Line calling-window guard (§3 of the SoT).
 *
 * The SoT requires recipient-LOCAL hours (~8am–9pm). This is intentionally
 * distinct from outbound-validation's Pacific-only window — leave that one
 * untouched. Fail-closed: no resolvable timezone → do not dial.
 */

export function localHour(now: Date, tz: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hour12: false,
    timeZone: tz,
  });
  // Intl can emit "24" at midnight in some runtimes — normalize to 0–23.
  return Number(fmt.format(now)) % 24;
}

export function isWithinCareCallWindow(now: Date, tz: string | null | undefined): boolean {
  if (!tz) return false; // no per-property timezone on file → never dial
  let h: number;
  try {
    h = localHour(now, tz);
  } catch {
    return false; // bad tz string → fail closed
  }
  if (!Number.isFinite(h)) return false;
  return h >= 8 && h < 21; // 8:00am–8:59pm local
}
