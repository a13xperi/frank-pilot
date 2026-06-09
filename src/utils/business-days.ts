/**
 * Business-day arithmetic for the FCRA pre-adverse-action window.
 *
 * The pre-adverse hold gives an applicant N *business* days to obtain a copy of
 * their consumer report and dispute it before a denial is finalized. Weekends
 * are skipped; public holidays are intentionally OUT OF SCOPE — ignoring them
 * can only make the window LONGER (more applicant-favorable / conservative),
 * never shorter, so it never under-counts the dispute period.
 *
 * Pure functions, no DB, no env, no clock of their own (caller passes `from`).
 */

/** Saturday (6) and Sunday (0) are not business days. */
export function isBusinessDay(d: Date): boolean {
  const day = d.getDay();
  return day !== 0 && day !== 6;
}

/**
 * Return a new Date that is `n` business days after `from`, preserving the
 * time-of-day of `from`. `n <= 0` (or non-finite) returns a copy of `from`
 * unchanged — a degenerate window finalizes on the next scheduler tick rather
 * than throwing.
 */
export function addBusinessDays(from: Date, n: number): Date {
  const result = new Date(from.getTime());
  if (!Number.isFinite(n) || n <= 0) return result;

  let added = 0;
  while (added < n) {
    result.setDate(result.getDate() + 1);
    if (isBusinessDay(result)) added++;
  }
  return result;
}
