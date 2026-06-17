/**
 * DM-FRANK-024 Accounts Payable — check state machine (pure, DB-free).
 *
 *   cut → reviewed → signed → disbursed
 *   cut|reviewed → rejected     (kicked back to the cutter, with a reason)
 *   any post-cut state → voided (elevated); a voided check is reissued as a
 *                                NEW check that references it (append-only).
 *
 * Kept separate from the service so the transition rules are unit-testable
 * without a database. The service layers separation-of-duties, the wet-signature
 * attestation, tape stamps, and audit logging on top of these rules.
 */

export type ApCheckState =
  | "cut"
  | "reviewed"
  | "signed"
  | "disbursed"
  | "rejected"
  | "voided";

export type ApCheckAction = "review" | "sign" | "disburse" | "reject" | "void";

/** Allowed (fromState, action) → toState transitions. */
const TRANSITIONS: Record<ApCheckState, Partial<Record<ApCheckAction, ApCheckState>>> = {
  cut: { review: "reviewed", reject: "rejected", void: "voided" },
  reviewed: { sign: "signed", reject: "rejected", void: "voided" },
  signed: { disburse: "disbursed", void: "voided" },
  disbursed: { void: "voided" },
  rejected: {}, // terminal — a re-cut starts a new check
  voided: {}, // terminal — a reissue starts a new check
};

export function canTransition(from: ApCheckState, action: ApCheckAction): boolean {
  return Boolean(TRANSITIONS[from]?.[action]);
}

/** Resolve the destination state, or throw if the transition is illegal. */
export function nextState(from: ApCheckState, action: ApCheckAction): ApCheckState {
  const to = TRANSITIONS[from]?.[action];
  if (!to) {
    throw new Error(`Illegal AP check transition: '${from}' cannot '${action}'`);
  }
  return to;
}

/** Which ap_approvals.step (if any) an action records. */
export function approvalStepFor(action: ApCheckAction): "review" | "sign" | null {
  if (action === "review") return "review";
  if (action === "sign") return "sign";
  return null;
}
