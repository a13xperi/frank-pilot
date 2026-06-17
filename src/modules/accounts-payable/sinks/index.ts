/**
 * DM-FRANK-024 — disbursement sink (the DM-FRANK-023 seam, shape-agnostic).
 *
 * The 023-independent AP core calls disburse() on the signed → disbursed
 * transition; which sink runs is selected by AP_DISBURSEMENT_SINK (realpage |
 * print). Both are STUBS until DM-FRANK-023 is Decided and Phase 2 lands the
 * chosen one:
 *   - realpage (Shape A, CFO's lean): push the AP entry to RealPage, return the
 *                                     voucher id; RealPage stays the cheque/GL SOR.
 *   - print    (Shape B):             render the blank-stock check artifact in-platform.
 *
 * Honest-stub rule (integrations doctrine): a stub that would touch an external
 * system without credentials FAILS LOUDLY rather than silently "succeeding".
 * The service takes a DisbursementSink by injection, so tests pass a fake.
 */

export interface DisburseInput {
  checkId: string;
  propertyId: string;
  amountCents: number;
  checkNumber: string | null;
  /** RealPage memo triad. */
  memo: {
    invoiceNumber: string | null;
    billingNumber: string | null;
    unitNumber: string | null;
  };
}

export interface DisbursementResult {
  /** External reference recorded on ap_checks.disbursement_ref. */
  ref: string;
  sink: "realpage" | "print";
}

export interface DisbursementSink {
  readonly kind: "realpage" | "print";
  disburse(input: DisburseInput): Promise<DisbursementResult>;
}

/** Shape A — RealPage push. Stub: gated on DM-FRANK-023 + REALPAGE_AP_* creds. */
export class RealPageSink implements DisbursementSink {
  readonly kind = "realpage" as const;
  async disburse(_input: DisburseInput): Promise<DisbursementResult> {
    const enabled = process.env.REALPAGE_AP_ENABLED === "true";
    const key = process.env.REALPAGE_AP_API_KEY;
    if (!enabled || !key) {
      // Never silently succeed a real disbursement without creds.
      throw new Error(
        "RealPage AP sink not configured (DM-FRANK-023 Shape A): set REALPAGE_AP_ENABLED + REALPAGE_AP_API_KEY",
      );
    }
    // The real push lands in Phase 2 once 023 picks Shape A.
    throw new Error("RealPage AP push not implemented yet (Phase 2, post-DM-FRANK-023)");
  }
}

/** Shape B — in-platform blank-stock print/export. Stub: gated on DM-FRANK-023. */
export class InPlatformPrintSink implements DisbursementSink {
  readonly kind = "print" as const;
  async disburse(_input: DisburseInput): Promise<DisbursementResult> {
    throw new Error(
      "In-platform check print not implemented yet (DM-FRANK-023 Shape B; needs blank-stock layout confirmation)",
    );
  }
}

/**
 * Select the sink from AP_DISBURSEMENT_SINK. Defaults to 'realpage' (the CFO's
 * current lean). Throws on an unknown value rather than guessing a sink.
 */
export function selectDisbursementSink(
  env: string | undefined = process.env.AP_DISBURSEMENT_SINK,
): DisbursementSink {
  const choice = (env || "realpage").toLowerCase();
  if (choice === "realpage") return new RealPageSink();
  if (choice === "print") return new InPlatformPrintSink();
  throw new Error(
    `Unknown AP_DISBURSEMENT_SINK '${env}' (expected 'realpage' | 'print')`,
  );
}
