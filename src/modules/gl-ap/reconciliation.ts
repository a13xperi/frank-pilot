/**
 * B3 — Parallel-run reconciliation (pure).
 *
 * During a parallel run the new GL records entries in SHADOW mode (never
 * system-of-record). This module compares the shadow book's derived balances
 * against the figures from the existing system that's still authoritative, and
 * produces a variance report. A clean report (no variances within tolerance) is
 * the evidence that lets a cutover decision be made for the parallel-run scope
 * (DM-FRANK-023). Tanya's intake supplies WHICH entity/property + WHICH month —
 * this is the engine that scores it.
 *
 * Pure: pass in the shadow balances + the source balances; get a report. No DB.
 */

import {
  AccountBalance,
  ReconciliationReport,
  ReconciliationVariance,
  SourceBalance,
} from "./types";

/** Default money tolerance for a "match": 1 cent (rounding noise only). */
export const DEFAULT_TOLERANCE = 0.01;

function cents(n: number): number {
  return Math.round(n * 100);
}

/**
 * Reconcile a shadow book's per-account net balances against the source-of-
 * record figures for the same period. Every account that appears in either side
 * is reported; only accounts whose |delta| exceeds the tolerance count as
 * variances. `matched` is true iff there are zero variances.
 */
export function reconcile(
  bookId: string,
  period: string,
  shadowBalances: AccountBalance[],
  sourceBalances: SourceBalance[],
  tolerance: number = DEFAULT_TOLERANCE
): ReconciliationReport {
  const tolCents = cents(tolerance);
  const shadowByCode = new Map<string, number>(
    shadowBalances
      .filter((b) => b.period === period)
      .map((b) => [b.accountCode, b.netBalance])
  );
  const sourceByCode = new Map<string, number>(
    sourceBalances.map((b) => [b.accountCode, b.netBalance])
  );

  const allCodes = new Set<string>([...shadowByCode.keys(), ...sourceByCode.keys()]);
  const variances: ReconciliationVariance[] = [];
  let shadowTotalCents = 0;
  let sourceTotalCents = 0;

  for (const code of [...allCodes].sort((a, b) => a.localeCompare(b))) {
    const inShadow = shadowByCode.has(code);
    const inSource = sourceByCode.has(code);
    const shadow = shadowByCode.get(code) ?? 0;
    const source = sourceByCode.get(code) ?? 0;
    shadowTotalCents += cents(shadow);
    sourceTotalCents += cents(source);

    const deltaCents = cents(shadow) - cents(source);
    let reason: ReconciliationVariance["reason"];
    if (!inSource) reason = "missing_in_source";
    else if (!inShadow) reason = "missing_in_shadow";
    else if (Math.abs(deltaCents) > tolCents) reason = "amount_mismatch";
    else reason = "matched";

    if (reason !== "matched") {
      variances.push({
        accountCode: code,
        shadow,
        source,
        delta: deltaCents / 100,
        reason,
      });
    }
  }

  return {
    bookId,
    period,
    matched: variances.length === 0,
    varianceCount: variances.length,
    variances,
    shadowTotal: shadowTotalCents / 100,
    sourceTotal: sourceTotalCents / 100,
  };
}

/** Human-readable one-line summary of a reconciliation report (for logs/CLI). */
export function summarizeReport(r: ReconciliationReport): string {
  if (r.matched) {
    return `[reconcile ${r.bookId} ${r.period}] MATCH — ${r.shadowTotal.toFixed(2)} shadow vs ${r.sourceTotal.toFixed(2)} source`;
  }
  return (
    `[reconcile ${r.bookId} ${r.period}] ${r.varianceCount} VARIANCE(S) — ` +
    r.variances
      .map((v) => `${v.accountCode}:${v.reason}(Δ${v.delta.toFixed(2)})`)
      .join(", ")
  );
}
