/**
 * BP-02 Compliance Tape — Event payload maker.
 *
 * Kind:     HUD_928_1_FAIR_HOUSING_POSTED
 * Citation: 24 CFR Part 110
 *
 * 24 CFR Part 110 (Equal Opportunity in Housing) requires that a HUD-928.1
 * "Equal Housing Opportunity" poster or notice be displayed / posted. This
 * stamp records that the notice was published on the given medium.
 */

import { TAPE_CITATIONS, TapeJsonLdPayload } from "../types";

const KIND = "HUD_928_1_FAIR_HOUSING_POSTED" as const;

/** The channel on which the fair housing notice was published. */
export type FairHousingMedium = "web" | "print" | "office";

export interface Hud9281FairHousingPostedInput {
  /** Optional idempotency / session key. */
  sessionId?: string;
  /** Property (site) where the notice was posted. */
  propertyId?: string;
  /** ISO-8601 timestamp supplied by the caller — no clock calls here. */
  postedAt: string;
  /** Delivery channel for the HUD-928.1 notice. */
  medium: FairHousingMedium;
}

/**
 * Pure function — no IO, no DB, no clock.
 * Caller is responsible for supplying `postedAt`.
 *
 * Note: this event is property-scoped, not applicant-scoped. The service
 * routes a non-null subjectId → compliance_tape.applicant_id, which is an FK
 * to users(id). A propertyId is NOT a users(id), so subjectId must ALWAYS be
 * null here (= global-scope chain) regardless of whether propertyId is known;
 * the propertyId is preserved in evidence below. (Passing propertyId as
 * subjectId silently FK-violates once COMPLIANCE_TAPE_V2_ENABLED is on —
 * stampSafe swallows the error and the stamp never writes.)
 */
export function makeHud9281FairHousingPostedPayload(
  input: Hud9281FairHousingPostedInput
): TapeJsonLdPayload {
  const { sessionId, propertyId, postedAt, medium } = input;

  return {
    "@context": "https://frank-pilot.example/compliance-tape/v1",
    "@type": "ComplianceEvent.Hud9281FairHousingPosted",
    actorId: null,
    // Property-scoped event → no user subject. subjectId stays null (global
    // scope); propertyId rides in evidence. See docblock above re: the
    // users(id) FK on compliance_tape.applicant_id.
    subjectId: null,
    ruleCitation: TAPE_CITATIONS[KIND],
    evidence: {
      postedAt,
      medium,
      ...(sessionId !== undefined ? { sessionId } : {}),
      ...(propertyId !== undefined ? { propertyId } : {}),
    },
  };
}
