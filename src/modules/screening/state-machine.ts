import { writeAuditLog } from "../../middleware/audit";
import { logger } from "../../utils/logger";
import { query } from "../../config/database";
import { stampV2ScreeningStateTransition } from "../tape/v2-stamp";

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
export async function transition(input: TransitionInput): Promise<void> {
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

// ---------------------------------------------------------------------------
// application_status chokepoint
//
// The abstract ScreeningState machine above models the screening pipeline's
// internal lifecycle. The functions below operate on the real
// `application_status` enum — the column the approval queue and applicant
// funnel actually read — and are the single writer of `applications.status`
// for the screening pipeline.
//
// Every transition is a compare-and-swap (WHERE id = $1 AND status = $from):
//   - success      → writes status, appends an idempotent status_history entry,
//                    writes a screening_state_transition audit row, emits a
//                    (dark) compliance-tape stamp, returns { changed: true }.
//   - 0-row CAS    → another writer already moved this app out of `from`
//                    (e.g. concurrent auto + manual screening). No-op: writes
//                    NOTHING and returns { changed: false }. Callers MUST gate
//                    exactly-once side effects (FCRA notice) on changed.
// ---------------------------------------------------------------------------

/** Real application_status values touched by the screening pipeline. */
export type AppStatus =
  | "submitted"
  | "awaiting_identity"
  | "awaiting_consumer_report"
  | "screening"
  | "screening_passed"
  | "screening_failed"
  | "screening_review";

interface AppStatusTransition {
  from: AppStatus;
  to: AppStatus;
  trigger: string;
}

export const APP_STATUS_TRANSITIONS: ReadonlyArray<AppStatusTransition> = [
  { from: "submitted", to: "screening", trigger: "screening_started" },
  // Stripe Identity (Phase 4b): submit() creates a VerificationSession and
  // parks the app in awaiting_identity until the webhook lands a verdict.
  // The webhook then advances awaiting_identity -> screening (verdict in hand,
  // run the checks) or -> screening_review (could_not_screen HOLD:
  // pending/processing/canceled/unmappable session — never an auto-pass).
  { from: "submitted", to: "awaiting_identity", trigger: "identity_verification_started" },
  { from: "awaiting_identity", to: "screening", trigger: "identity_session_resolved" },
  { from: "awaiting_identity", to: "screening_review", trigger: "could_not_screen" },
  // Consumer-report CRA (Checkr background + TransUnion ShareAble credit):
  // submit() creates the report order(s) and parks the app in
  // awaiting_consumer_report until the webhook lands a verdict. The webhook then
  // advances awaiting_consumer_report -> screening (verdict in hand, run the
  // checks) or -> screening_review (could_not_screen HOLD: report
  // pending/canceled/unmappable — never an auto-pass). Mirrors the identity
  // triple above.
  { from: "submitted", to: "awaiting_consumer_report", trigger: "consumer_report_started" },
  { from: "awaiting_consumer_report", to: "screening", trigger: "consumer_report_resolved" },
  { from: "awaiting_consumer_report", to: "screening_review", trigger: "could_not_screen" },
  { from: "screening", to: "screening_passed", trigger: "all_checks_passed" },
  { from: "screening", to: "screening_passed", trigger: "review_required_passthrough" },
  { from: "screening", to: "screening_failed", trigger: "any_check_failed" },
  { from: "screening", to: "screening_failed", trigger: "identity_rejected" },
  { from: "screening", to: "screening_failed", trigger: "duplicate_ssn" },
  // could_not_screen — the vendor pipeline threw (config/infra failure, no
  // verdict). HOLD the application in a non-approvable status until staff
  // resolve it manually. NEVER auto-passes.
  { from: "screening", to: "screening_review", trigger: "could_not_screen" },
  // individualized_assessment_required — the background check surfaced a
  // discretionary criminal record inside the lookback (HUD/FHA Castro §III.B).
  // It must NOT auto-fail (no time-blind blanket ban) and must NOT auto-pass
  // (the assessment must happen). HOLD in screening_review for staff to run the
  // individualized assessment before any denial.
  { from: "screening", to: "screening_review", trigger: "individualized_assessment_required" },
  { from: "screening_review", to: "screening_passed", trigger: "manual_override_pass" },
  { from: "screening_review", to: "screening_failed", trigger: "manual_override_fail" },
];

export interface AppStatusTransitionInput {
  applicationId: string;
  from: AppStatus;
  to: AppStatus;
  trigger: string;
  actorId?: string;
  actorRole?: string;
  evidence?: Record<string, unknown>;
}

export interface AppStatusTransitionResult {
  changed: boolean;
  status: AppStatus;
}

function isValidAppStatusTransition(from: AppStatus, to: AppStatus, trigger: string): boolean {
  return APP_STATUS_TRANSITIONS.some(
    (t) => t.from === from && t.to === to && t.trigger === trigger
  );
}

/**
 * Atomically move applications.status via compare-and-swap, recording the
 * transition in status_history + audit_log + (dark) compliance tape.
 *
 * Returns { changed: false } when the CAS matches 0 rows (the app already left
 * `from`). Callers MUST gate any exactly-once side effect (FCRA adverse-action
 * notice) on `changed === true`.
 *
 * @throws if (from, to, trigger) is not a defined transition.
 */
export async function transitionApplicationStatus(
  input: AppStatusTransitionInput
): Promise<AppStatusTransitionResult> {
  const { applicationId, from, to, trigger, actorId, actorRole, evidence } = input;

  if (!isValidAppStatusTransition(from, to, trigger)) {
    throw new Error(
      `Invalid application_status transition: ${from} -> ${to} (trigger '${trigger}')`
    );
  }

  // $2 (to) and $3 (from) are each used twice: once compared/assigned against
  // the application_status enum column and once rendered as text inside the
  // status_history JSONB. Without explicit casts on the enum sites, Postgres
  // deduces conflicting types for the same parameter ("inconsistent types
  // deduced for parameter $2") and the statement fails to prepare. Cast the
  // enum sites explicitly so each parameter resolves to a single base type.
  const result = await query(
    `UPDATE applications
        SET status = $2::application_status,
            status_history = status_history || jsonb_build_object(
              'from', $3::text,
              'to', $2::text,
              'trigger', $4::text,
              'actorId', $5::text,
              'actorRole', $6::text,
              'at', NOW(),
              'evidence', $7::jsonb
            )
      WHERE id = $1 AND status = $3::application_status
      RETURNING id`,
    [
      applicationId,
      to,
      from,
      trigger,
      actorId ?? null,
      actorRole ?? null,
      JSON.stringify(evidence ?? {}),
    ]
  );

  if (result.rows.length === 0) {
    // Lost the compare-and-swap — skip audit, tape, and caller-gated side effects.
    logger.info("application_status transition no-op (CAS miss)", {
      applicationId,
      from,
      to,
      trigger,
    });
    return { changed: false, status: to };
  }

  await writeAuditLog({
    action: "screening_state_transition",
    actorId,
    actorRole,
    applicationId,
    resourceType: "application",
    details: {
      fromStatus: from,
      toStatus: to,
      trigger,
      evidence: evidence || {},
    },
  });

  // Dark compliance-tape stamp — no-op unless COMPLIANCE_TAPE_V2_ENABLED.
  void stampV2ScreeningStateTransition({
    applicationId,
    fromStatus: from,
    toStatus: to,
    trigger,
    actorId: actorId ?? null,
    actorRole,
    transitionedAt: new Date().toISOString(),
    evidence,
  });

  logger.info("application_status transition", {
    applicationId,
    from,
    to,
    trigger,
  });

  return { changed: true, status: to };
}
