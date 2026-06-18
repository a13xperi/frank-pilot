/**
 * BP-02 Compliance Tape — Event payload maker.
 *
 * Kind:     unit.identity_anchored
 * Citation: IRC §42 + 26 CFR 1.42-5
 *
 * Unit-identity Phase B (WS-3). Anchors a UNIT's stable identity onto its own
 * hash chain (TapeScope { type: "unit" }), separate from the applicant/global
 * chains. Records the unit's LIHTC §42 Building Identification Number (BIN) plus
 * the source-of-truth identity tokens (lot number, parcel, "the permit",
 * external uid) so the unit's compliance history is rooted in a tamper-evident,
 * §42 / 26 CFR 1.42-5-cited genesis event.
 *
 * This is the maker that lights up the dormant `payload.bin` field: it emits
 * both `bin` (the §42 BIN) and `unitId` at the top level of the JSON-LD payload
 * so the service can derive the unit scope and the `payload->>'bin'` index has
 * something to point at.
 */

import { TAPE_CITATIONS, TapeJsonLdPayload } from "../types";

const KIND = "unit.identity_anchored" as const;

export interface UnitIdentityAnchoredInput {
  /** The unit whose identity is being anchored — this is the UNIT tape scope
   *  key (compliance_tape.subject_unit_id → units(id)). */
  unitId: string;
  /** LIHTC §42 Building Identification Number for the unit's building. Emitted
   *  at payload.bin (top level) so the §42 BIN index lights up. */
  bin?: string | null;
  /** Windsor lot number (lot == unit), if known. */
  lotNumber?: string | null;
  /** Resolved parcel id (units.parcel_id or via buildings.parcel_id). */
  parcelId?: string | null;
  /** Denormalized "the permit" — units.primary_permit_number. */
  primaryPermitNumber?: string | null;
  /** Source-system identity token, e.g. "WNDSR-001" (units.external_uid). */
  externalUid?: string | null;
  /** Who anchored the identity (user/system id) or null. */
  actorId?: string | null;
  /** ISO-8601 timestamp supplied by the caller — no clock calls here. */
  anchoredAt: string;
  /** Optional idempotency / session key. */
  sessionId?: string;
}

/**
 * Pure function — no IO, no DB, no clock.
 * Caller is responsible for supplying `anchoredAt`.
 *
 * NOTE: subjectId is left null — the UNIT scope is carried by payload.unitId
 * (read by the service / passed via TapeEvent.scope), NOT by subjectId, which
 * is FK'd to users(id) through compliance_tape.applicant_id and must never hold
 * a unit id. The caller stamps this with an explicit { type: "unit"; unitId }
 * scope (see stampV2UnitIdentityAnchored).
 */
export function makeUnitIdentityAnchoredPayload(
  input: UnitIdentityAnchoredInput
): TapeJsonLdPayload {
  const {
    unitId,
    bin,
    lotNumber,
    parcelId,
    primaryPermitNumber,
    externalUid,
    actorId,
    anchoredAt,
    sessionId,
  } = input;

  return {
    "@context": "https://frank-pilot.example/compliance-tape/v1",
    "@type": "ComplianceEvent.UnitIdentityAnchored",
    actorId: actorId ?? null,
    // subjectId stays null: the unit scope is on payload.unitId + TapeEvent.scope,
    // never routed through the users(id)-FK'd applicant_id column.
    subjectId: null,
    ruleCitation: TAPE_CITATIONS[KIND],
    // Top-level unitId/bin light up the dormant fields: bin -> payload->>'bin'
    // index; unitId -> service unit-scope derivation.
    unitId,
    ...(bin != null ? { bin } : {}),
    evidence: {
      unitId,
      anchoredAt,
      ...(bin != null ? { bin } : {}),
      ...(lotNumber != null ? { lotNumber } : {}),
      ...(parcelId != null ? { parcelId } : {}),
      ...(primaryPermitNumber != null ? { primaryPermitNumber } : {}),
      ...(externalUid != null ? { externalUid } : {}),
      ...(sessionId !== undefined ? { sessionId } : {}),
    },
  };
}
