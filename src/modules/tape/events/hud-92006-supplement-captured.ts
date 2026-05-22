/**
 * BP-02 Compliance Tape — Event payload maker.
 *
 * Kind:     HUD_92006_SUPPLEMENT_CAPTURED
 * Citation: HUD-92006
 *
 * HUD-92006 (Supplement to Application for Federally Assisted Housing) gives
 * applicants the opportunity to designate a person to be notified in case of
 * lease termination. This stamp records whether the applicant completed / opted
 * into the HUD-92006 supplement form.
 */

import { TAPE_CITATIONS, TapeJsonLdPayload } from "../types";

const KIND = "HUD_92006_SUPPLEMENT_CAPTURED" as const;

export interface Hud92006SupplementCapturedInput {
  /** The applicant who was offered the HUD-92006 supplement. */
  applicantId: string;
  /** Optional idempotency / session key. */
  sessionId?: string;
  /** ISO-8601 timestamp supplied by the caller — no clock calls here. */
  capturedAt: string;
  /**
   * `true`  — applicant filled in the supplement (named a contact).
   * `false` — applicant was offered the form but declined / left it blank.
   */
  supplementOptedIn: boolean;
}

/**
 * Pure function — no IO, no DB, no clock.
 * Caller is responsible for supplying `capturedAt`.
 */
export function makeHud92006SupplementCapturedPayload(
  input: Hud92006SupplementCapturedInput
): TapeJsonLdPayload {
  const { applicantId, sessionId, capturedAt, supplementOptedIn } = input;

  return {
    "@context": "https://frank-pilot.example/compliance-tape/v1",
    "@type": "ComplianceEvent.Hud92006SupplementCaptured",
    actorId: null,
    subjectId: applicantId,
    ruleCitation: TAPE_CITATIONS[KIND],
    evidence: {
      applicantId,
      capturedAt,
      supplementOptedIn,
      ...(sessionId !== undefined ? { sessionId } : {}),
    },
  };
}
