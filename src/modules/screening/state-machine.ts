import { PoolClient } from "pg";
import { writeAuditLog } from "../../middleware/audit";
import { logger } from "../../utils/logger";

export type ScreeningState =
  | "queued"
  | "id_verifying"
  | "id_verified"
  | "fraud_screening"
  | "screening"
  | "manual_review"
  | "passed"
  | "failed"
  | "withdrawn";

export interface StateTransition {
  from: ScreeningState;
  to: ScreeningState;
  trigger: string;
}

export const TERMINAL_STATES: ReadonlyArray<ScreeningState> = ["passed", "failed", "withdrawn"];

export const TRANSITIONS: ReadonlyArray<StateTransition> = [
  { from: "queued", to: "id_verifying", trigger: "screening_initiated" },
  { from: "queued", to: "withdrawn", trigger: "applicant_withdrew" },

  { from: "id_verifying", to: "id_verified", trigger: "identity_verification_passed" },
  { from: "id_verifying", to: "failed", trigger: "identity_verification_failed" },
  { from: "id_verifying", to: "manual_review", trigger: "identity_verification_inconclusive" },
  { from: "id_verifying", to: "withdrawn", trigger: "applicant_withdrew" },

  { from: "id_verified", to: "fraud_screening", trigger: "auto_advance" },

  { from: "fraud_screening", to: "screening", trigger: "fraud_screening_clean" },
  { from: "fraud_screening", to: "manual_review", trigger: "fraud_flag_raised" },
  { from: "fraud_screening", to: "failed", trigger: "duplicate_ssn_detected" },
  { from: "fraud_screening", to: "withdrawn", trigger: "applicant_withdrew" },

  { from: "screening", to: "passed", trigger: "all_checks_passed" },
  { from: "screening", to: "failed", trigger: "any_check_failed" },
  { from: "screening", to: "manual_review", trigger: "any_check_review_required" },
  { from: "screening", to: "withdrawn", trigger: "applicant_withdrew" },

  { from: "manual_review", to: "passed", trigger: "manual_override_pass" },
  { from: "manual_review", to: "failed", trigger: "manual_override_fail" },
  { from: "manual_review", to: "withdrawn", trigger: "applicant_withdrew" },
];

export function isTerminal(state: ScreeningState): boolean {
  return TERMINAL_STATES.includes(state);
}

export function canTransition(from: ScreeningState, to: ScreeningState): boolean {
  if (isTerminal(from)) return false;
  return TRANSITIONS.some((t) => t.from === from && t.to === to);
}

export function validTriggers(from: ScreeningState, to: ScreeningState): string[] {
  return TRANSITIONS.filter((t) => t.from === from && t.to === to).map((t) => t.trigger);
}

export interface TransitionInput {
  applicationId: string;
  from: ScreeningState;
  to: ScreeningState;
  trigger: string;
  actorId?: string;
  actorRole?: string;
  evidence?: Record<string, unknown>;
}

/**
 * Atomically record a screening state transition.
 *
 * Writes:
 *   1. An audit_log row (everyday queryable audit)
 *   2. Appends to applications.status_history (JSONB array) — deferred to the
 *      Phase 4 step 4 migration; this stub writes the audit row only.
 *
 * The compliance_tape extension (kind: screening.state_transition) is also
 * deferred to Phase 4 step 4 (requires TapeStampKind update + Lane A/B/C
 * signoff per docs/bp-02-contracts.md §5).
 *
 * Throws if the transition is not valid per the TRANSITIONS table.
 */
export async function transition(
  _client: PoolClient | null,
  input: TransitionInput
): Promise<void> {
  const { applicationId, from, to, trigger, actorId, actorRole, evidence } = input;

  if (!canTransition(from, to)) {
    const reason = isTerminal(from)
      ? `cannot transition out of terminal state ${from}`
      : `no transition defined from ${from} to ${to}`;
    throw new Error(`Invalid screening state transition: ${reason}`);
  }

  const allowedTriggers = validTriggers(from, to);
  if (!allowedTriggers.includes(trigger)) {
    throw new Error(
      `Invalid trigger '${trigger}' for transition ${from} -> ${to}. ` +
        `Allowed: ${allowedTriggers.join(", ")}`
    );
  }

  await writeAuditLog({
    action: "screening_state_transition",
    actorId,
    actorRole,
    applicationId,
    resourceType: "application",
    details: {
      fromState: from,
      toState: to,
      trigger,
      evidence: evidence || {},
    },
  });

  logger.info("Screening state transition", {
    applicationId,
    from,
    to,
    trigger,
  });
}
