/**
 * BP-02 Compliance Tape — Event payload maker.
 *
 * Kind:     screening.state_transition
 * Citation: FCRA 15 U.S.C. §1681b + HUD 4350.3 Ch. 4
 *
 * Records each screening-driven application_status transition
 * (submitted → screening → screening_passed | screening_failed). Tenant
 * screening is an FCRA "consumer report" use; the resulting eligibility
 * determination is governed by HUD 4350.3 Ch. 4. This stamp attests the
 * automated decision trail behind every status move.
 */

import { TAPE_CITATIONS, TapeJsonLdPayload } from "../types";

const KIND = "screening.state_transition" as const;

export interface ScreeningStateTransitionInput {
  /** The application whose status changed (tape subject + scope key). */
  applicationId: string;
  /** Status the application moved from. */
  fromStatus: string;
  /** Status the application moved to. */
  toStatus: string;
  /** The trigger that drove the edge (e.g. "all_checks_passed"). */
  trigger: string;
  /** Who/what drove the transition (user id) or null for system. */
  actorId?: string | null;
  /** Role of the actor (user_role value), if any. */
  actorRole?: string;
  /** ISO-8601 timestamp supplied by the caller — no clock calls here. */
  transitionedAt: string;
  /** Optional idempotency / session key. */
  sessionId?: string;
  /** Kind-specific evidence (failed checks, risk signals, …). */
  evidence?: Record<string, unknown>;
}

/**
 * Pure function — no IO, no DB, no clock.
 * Caller is responsible for supplying `transitionedAt`.
 */
export function makeScreeningStateTransitionPayload(
  input: ScreeningStateTransitionInput
): TapeJsonLdPayload {
  const {
    applicationId,
    fromStatus,
    toStatus,
    trigger,
    actorId,
    actorRole,
    transitionedAt,
    evidence,
  } = input;

  return {
    "@context": "https://frank-pilot.example/compliance-tape/v1",
    "@type": "ComplianceEvent.ScreeningStateTransition",
    actorId: actorId ?? null,
    // subjectId drives tape scope → compliance_tape.applicant_id, which is an
    // FK to users(id). An application id is NOT a users(id) and would violate
    // that FK once COMPLIANCE_TAPE_V2_ENABLED is on. Scope by the actor user
    // (users(id)-or-null); the application id is preserved in evidence below.
    subjectId: actorId ?? null,
    ruleCitation: TAPE_CITATIONS[KIND],
    evidence: {
      applicationId,
      fromStatus,
      toStatus,
      trigger,
      transitionedAt,
      ...(actorRole !== undefined ? { actorRole } : {}),
      ...(evidence !== undefined ? { evidence } : {}),
    },
  };
}
