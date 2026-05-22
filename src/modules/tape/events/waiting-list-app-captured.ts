/**
 * BP-02 Compliance Tape — Event payload maker.
 *
 * Kind:     WAITING_LIST_APP_CAPTURED
 * Citation: HUD 4350.3 Ch. 4-6
 *
 * HUD 4350.3 Ch. 4-6 requires properties to maintain a written waiting list
 * and to record each application. This stamp records the moment an applicant's
 * waiting-list application is captured (written) in the system.
 */

import { TAPE_CITATIONS, TapeJsonLdPayload } from "../types";

const KIND = "WAITING_LIST_APP_CAPTURED" as const;

export interface WaitingListAppCapturedInput {
  /** The applicant whose application was captured. */
  applicantId: string;
  /** Optional idempotency / session key. */
  sessionId?: string;
  /** Property (site) the applicant is applying to. */
  propertyId?: string;
  /** Number of bedrooms requested; undefined when not yet declared. */
  bedroomCount?: number;
  /** ISO-8601 timestamp supplied by the caller — no clock calls here. */
  capturedAt: string;
}

/**
 * Pure function — no IO, no DB, no clock.
 * Caller is responsible for supplying `capturedAt`.
 */
export function makeWaitingListAppCapturedPayload(
  input: WaitingListAppCapturedInput
): TapeJsonLdPayload {
  const { applicantId, sessionId, propertyId, bedroomCount, capturedAt } =
    input;

  return {
    "@context": "https://frank-pilot.example/compliance-tape/v1",
    "@type": "ComplianceEvent.WaitingListAppCaptured",
    actorId: null,
    subjectId: applicantId,
    ruleCitation: TAPE_CITATIONS[KIND],
    evidence: {
      applicantId,
      capturedAt,
      ...(sessionId !== undefined ? { sessionId } : {}),
      ...(propertyId !== undefined ? { propertyId } : {}),
      ...(bedroomCount !== undefined ? { bedroomCount } : {}),
    },
  };
}
