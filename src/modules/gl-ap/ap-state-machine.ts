/**
 * B3 — Accounts-Payable BILL lifecycle state machine (pure, DB-free).
 *
 * Models the universal AP flow: a vendor bill is taken in, approved (or
 * rejected), scheduled, paid (possibly in parts), and finally fully paid. A
 * bill can be voided from any non-terminal pre-payment state. This is the
 * generic skeleton — WHO may approve and the SoD rules layer on in the service.
 *
 *   draft → submitted → approved → scheduled → partially_paid → paid
 *                    ↘ rejected (terminal)
 *   approved|scheduled|partially_paid → (record_payment) advances toward paid
 *   draft|submitted|approved|scheduled → voided (terminal)
 *
 * Kept separate from the service so the transition rules are unit-testable
 * without a database — mirrors the existing accounts-payable/state-machine.ts.
 *
 * Note: this is the BILL state machine (B3, the GL/AP foundation). It is
 * distinct from the in-flight check-cutting state machine in
 * src/modules/accounts-payable (DM-FRANK-024), which governs a disbursement
 * CHECK's lifecycle. They compose: a bill reaches `scheduled`, a check is cut.
 */

import { ApBillStatus } from "./types";

export type ApBillAction =
  | "submit"
  | "approve"
  | "reject"
  | "schedule"
  | "record_payment" // amount-dependent: → partially_paid or paid (resolved by caller)
  | "void";

/**
 * Allowed (fromState, action) → toState transitions. `record_payment` is special
 * because the destination depends on whether the bill is fully covered; the
 * value here is the NON-final landing (`partially_paid`) and the service/helper
 * promotes to `paid` when amount_paid >= amount (see settlePaymentState).
 */
const TRANSITIONS: Record<ApBillStatus, Partial<Record<ApBillAction, ApBillStatus>>> = {
  draft: { submit: "submitted", void: "voided" },
  submitted: { approve: "approved", reject: "rejected", void: "voided" },
  approved: { schedule: "scheduled", record_payment: "partially_paid", void: "voided" },
  scheduled: { record_payment: "partially_paid", void: "voided" },
  partially_paid: { record_payment: "partially_paid" }, // promoted to paid by amount
  paid: {}, // terminal
  rejected: {}, // terminal
  voided: {}, // terminal
};

export function canTransition(from: ApBillStatus, action: ApBillAction): boolean {
  return Boolean(TRANSITIONS[from]?.[action]);
}

/** Resolve the destination state, or throw if the transition is illegal. */
export function nextState(from: ApBillStatus, action: ApBillAction): ApBillStatus {
  const to = TRANSITIONS[from]?.[action];
  if (!to) {
    throw new Error(`Illegal AP bill transition: '${from}' cannot '${action}'`);
  }
  return to;
}

/** Terminal states accept no further actions. */
export function isTerminal(state: ApBillStatus): boolean {
  return Object.keys(TRANSITIONS[state] ?? {}).length === 0;
}

/**
 * Resolve the true post-payment state from the running totals. Called after a
 * `record_payment` transition: a bill is `paid` once cumulative payments cover
 * the bill amount, otherwise `partially_paid`. Amounts compared in cents to
 * avoid float drift. Overpayment is treated as fully paid (the caller decides
 * whether to reject overpayment upstream).
 */
export function settlePaymentState(amount: number, amountPaid: number): ApBillStatus {
  const amt = Math.round(amount * 100);
  const paid = Math.round(amountPaid * 100);
  if (paid <= 0) {
    throw new Error("settlePaymentState called with no payment applied");
  }
  return paid >= amt ? "paid" : "partially_paid";
}

/**
 * Which lifecycle actions correspond to GL-posting moments. Generic: at intake
 * we post nothing; approval/scheduling may accrue the payable (Dr expense / Cr
 * AP); a payment posts the disbursement (Dr AP / Cr cash). The actual Dr/Cr
 * pair is NEVER hardcoded here — it comes from the PostingRule for the bill's
 * source_doc_type. This just says WHEN a posting is expected.
 */
export function postingMomentFor(
  action: ApBillAction
): "accrue_payable" | "disburse_payment" | null {
  if (action === "approve") return "accrue_payable";
  if (action === "record_payment") return "disburse_payment";
  return null;
}
