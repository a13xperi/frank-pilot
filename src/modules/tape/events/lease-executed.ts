/**
 * BP-02 Compliance Tape — Event payload maker.
 *
 * Kind:     LEASE_EXECUTED
 * Citation: HUD 4350.3 Ch. 6-5 + 15 U.S.C. 7001 (ESIGN)
 *
 * Recorded when a tenant electronically signs their lease in-app. This is the
 * legally-meaningful audit record for the e-signature: it attests the signer,
 * the ESIGN/UETA consent timestamp, the signing IP, and a SHA-256 hash of the
 * executed PDF so the document is tamper-evident after the fact.
 */

import { TAPE_CITATIONS, TapeJsonLdPayload } from "../types";

const KIND = "LEASE_EXECUTED" as const;

export interface LeaseExecutedInput {
  /** The application whose lease was executed (carried in evidence). */
  applicationId: string;
  /** The user (tenant) who signed — this is the per-applicant tape scope key. */
  signerId: string;
  /** Typed legal name the signer attested to. */
  signerName: string;
  /** ISO-8601 timestamp the signature was applied — caller supplies it. */
  signedAt: string;
  /** ISO-8601 timestamp the ESIGN consent checkbox was affirmed. */
  consentAt: string;
  /** Originating IP of the signing request, if captured. */
  signerIp?: string | null;
  /** SHA-256 (hex) of the executed PDF. Tamper-evidence anchor. */
  documentHash?: string | null;
  /** Optional idempotency / session key. */
  sessionId?: string;
  /** Unit-identity Phase B (WS-3): the unit this lease is for. When set, the
   *  lease execution is ALSO dual-written onto the unit chain (additive — the
   *  applicant-scoped stamp above is unchanged). units(id). */
  unitId?: string | null;
  /** LIHTC §42 BIN of the leased unit's building, carried onto the unit chain. */
  bin?: string | null;
}

/**
 * Pure function — no IO, no DB, no clock.
 * Caller is responsible for supplying `signedAt` / `consentAt`.
 */
export function makeLeaseExecutedPayload(
  input: LeaseExecutedInput
): TapeJsonLdPayload {
  const {
    applicationId,
    signerId,
    signerName,
    signedAt,
    consentAt,
    signerIp,
    documentHash,
    sessionId,
    unitId,
    bin,
  } = input;

  return {
    "@context": "https://frank-pilot.example/compliance-tape/v1",
    "@type": "ComplianceEvent.LeaseExecuted",
    actorId: signerId,
    // subjectId is the tape scope key and is FK'd to users — it must be the
    // signer's user id, NOT the applicationId. The application is preserved in
    // evidence below.
    subjectId: signerId,
    ruleCitation: TAPE_CITATIONS[KIND],
    // Top-level bin/unitId light up the dormant fields when the lease is for a
    // known unit; they do not affect the applicant-scoped derivation (which
    // keys on subjectId). Absent when the caller omits unit context.
    ...(bin != null ? { bin } : {}),
    ...(unitId != null ? { unitId } : {}),
    evidence: {
      applicationId,
      signerId,
      signerName,
      signedAt,
      consentAt,
      ...(signerIp != null ? { signerIp } : {}),
      ...(documentHash != null ? { documentHash } : {}),
      ...(sessionId !== undefined ? { sessionId } : {}),
      ...(unitId != null ? { unitId } : {}),
      ...(bin != null ? { bin } : {}),
    },
  };
}
