/**
 * BP-02 Compliance Tape — Event payload maker.
 *
 * Kind:     WELCOME_LETTER_DELIVERED
 * Citation: HUD 4350.3 Ch. 4-4
 *
 * HUD 4350.3 Ch. 4-4 requires that applicants receive a welcome / acknowledgment
 * letter upon receipt of their application. This stamp records that delivery.
 */

import { TAPE_CITATIONS, TapeJsonLdPayload } from "../types";

const KIND = "WELCOME_LETTER_DELIVERED" as const;

export interface WelcomeLetterDeliveredInput {
  /** The applicant who received the letter. */
  applicantId: string;
  /** Optional idempotency / session key. */
  sessionId?: string;
  /** Property (site) for which the application was received. */
  propertyId?: string;
  /** ISO-8601 timestamp supplied by the caller — no clock calls here. */
  deliveredAt: string;
}

/**
 * Pure function — no IO, no DB, no clock.
 * Caller is responsible for supplying `deliveredAt`.
 */
export function makeWelcomeLetterDeliveredPayload(
  input: WelcomeLetterDeliveredInput
): TapeJsonLdPayload {
  const { applicantId, sessionId, propertyId, deliveredAt } = input;

  return {
    "@context": "https://frank-pilot.example/compliance-tape/v1",
    "@type": "ComplianceEvent.WelcomeLetterDelivered",
    actorId: null,
    subjectId: applicantId,
    ruleCitation: TAPE_CITATIONS[KIND],
    evidence: {
      applicantId,
      deliveredAt,
      ...(sessionId !== undefined ? { sessionId } : {}),
      ...(propertyId !== undefined ? { propertyId } : {}),
    },
  };
}
