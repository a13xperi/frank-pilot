/**
 * BP-02 Compliance Tape — Event payload maker.
 *
 * Kind:     POSITION_LETTER_SENT
 * Citation: HUD 4350.3 Ch. 4-14 + 4-16
 *
 * HUD 4350.3 Ch. 4-14 (notification of waiting list position) and Ch. 4-16
 * (update letters) require that applicants be notified of their position on
 * the waiting list and of any changes. This stamp records that a position
 * letter was dispatched to a specific applicant.
 */

import { TAPE_CITATIONS, TapeJsonLdPayload } from "../types";

const KIND = "POSITION_LETTER_SENT" as const;

export interface PositionLetterSentInput {
  /** The applicant who received the position letter. */
  applicantId: string;
  /** Optional idempotency / session key. */
  sessionId?: string;
  /** Property (site) for which the position applies. */
  propertyId: string;
  /** Bedroom size for which the applicant is queued. */
  bedroomCount: number;
  /** Applicant's current position on the waiting list (1-based). */
  position: number;
  /** ISO-8601 timestamp supplied by the caller — no clock calls here. */
  sentAt: string;
}

/**
 * Pure function — no IO, no DB, no clock.
 * Caller is responsible for supplying `sentAt`.
 */
export function makePositionLetterSentPayload(
  input: PositionLetterSentInput
): TapeJsonLdPayload {
  const { applicantId, sessionId, propertyId, bedroomCount, position, sentAt } =
    input;

  return {
    "@context": "https://frank-pilot.example/compliance-tape/v1",
    "@type": "ComplianceEvent.PositionLetterSent",
    actorId: null,
    subjectId: applicantId,
    ruleCitation: TAPE_CITATIONS[KIND],
    evidence: {
      applicantId,
      propertyId,
      bedroomCount,
      position,
      sentAt,
      ...(sessionId !== undefined ? { sessionId } : {}),
    },
  };
}
