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
 * routes subjectId → compliance_tape.applicant_id (UUID column), so when
 * propertyId is unknown subjectId must be null (= global-scope chain). A
 * non-UUID sentinel like "n/a" trips the column type and the stamp errors.
 */
export function makeHud9281FairHousingPostedPayload(
  input: Hud9281FairHousingPostedInput
): TapeJsonLdPayload {
  const { sessionId, propertyId, postedAt, medium } = input;

  return {
    "@context": "https://frank-pilot.example/compliance-tape/v1",
    "@type": "ComplianceEvent.Hud9281FairHousingPosted",
    actorId: null,
    subjectId: propertyId ?? null,
    ruleCitation: TAPE_CITATIONS[KIND],
    evidence: {
      postedAt,
      medium,
      ...(sessionId !== undefined ? { sessionId } : {}),
      ...(propertyId !== undefined ? { propertyId } : {}),
    },
  };
}
