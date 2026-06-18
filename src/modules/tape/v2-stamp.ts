/**
 * BP-02 Lane G — dual-write wrapper for the new compliance tape.
 *
 * Sits beside the legacy `stampTape()` (NDJSON ledger) and writes the same
 * event to the new hash-chained Postgres tape if `COMPLIANCE_TAPE_V2_ENABLED`
 * is set in env. The flag defaults off so this is a no-op until cutover.
 *
 * Errors are logged and swallowed — a tape write failure must never break
 * the applicant flow. The legacy ledger remains the source of truth until
 * Phase 3 retires it.
 *
 * Each wrapper forwards its argument directly to the matching Lane C maker,
 * so call sites must provide everything the canonical JSON-LD shape needs.
 * That's intentional: it forces touchpoint code to attest the full evidence
 * set, not whatever happened to be in scope for the NDJSON stub.
 */

import { logger } from "../../utils/logger";
import { createTapeService, type TapeService } from "./service";
import { PgTapeRepository } from "./repository";
import {
  makeWelcomeLetterDeliveredPayload,
  makeHud9281FairHousingPostedPayload,
  makeWaitingListAppCapturedPayload,
  makeHud92006SupplementCapturedPayload,
  makePositionLetterSentPayload,
  makeLeaseExecutedPayload,
  makeScreeningStateTransitionPayload,
  makeUnitIdentityAnchoredPayload,
  type WelcomeLetterDeliveredInput,
  type Hud9281FairHousingPostedInput,
  type WaitingListAppCapturedInput,
  type Hud92006SupplementCapturedInput,
  type PositionLetterSentInput,
  type LeaseExecutedInput,
  type ScreeningStateTransitionInput,
  type UnitIdentityAnchoredInput,
} from "./events";
import {
  COMPLIANCE_TAPE_V2_FLAG,
  type TapeJsonLdPayload,
  type TapeScope,
  type TapeStampKind,
} from "./types";

function flagEnabled(): boolean {
  return process.env[COMPLIANCE_TAPE_V2_FLAG] === "true";
}

let serviceCache: TapeService | null = null;
function getService(): TapeService {
  if (!serviceCache) {
    serviceCache = createTapeService(new PgTapeRepository());
  }
  return serviceCache;
}

/** For tests. */
export function resetTapeServiceCache(): void {
  serviceCache = null;
}

async function stampV2(
  kind: TapeStampKind,
  payload: TapeJsonLdPayload,
  sessionId?: string,
  scope?: TapeScope,
): Promise<void> {
  if (!flagEnabled()) return;
  try {
    await getService().stamp({ kind, payload, sessionId, scope });
  } catch (err) {
    logger.error("Tape v2 stamp failed", {
      kind,
      error: (err as Error).message,
    });
  }
}

export async function stampV2WelcomeLetterDelivered(
  input: WelcomeLetterDeliveredInput,
): Promise<void> {
  if (!flagEnabled()) return;
  return stampV2(
    "WELCOME_LETTER_DELIVERED",
    makeWelcomeLetterDeliveredPayload(input),
    input.sessionId,
  );
}

export async function stampV2Hud9281FairHousingPosted(
  input: Hud9281FairHousingPostedInput,
): Promise<void> {
  if (!flagEnabled()) return;
  return stampV2(
    "HUD_928_1_FAIR_HOUSING_POSTED",
    makeHud9281FairHousingPostedPayload(input),
    input.sessionId,
  );
}

export async function stampV2WaitingListAppCaptured(
  input: WaitingListAppCapturedInput,
): Promise<void> {
  if (!flagEnabled()) return;
  return stampV2(
    "WAITING_LIST_APP_CAPTURED",
    makeWaitingListAppCapturedPayload(input),
    input.sessionId,
  );
}

export async function stampV2Hud92006SupplementCaptured(
  input: Hud92006SupplementCapturedInput,
): Promise<void> {
  if (!flagEnabled()) return;
  return stampV2(
    "HUD_92006_SUPPLEMENT_CAPTURED",
    makeHud92006SupplementCapturedPayload(input),
    input.sessionId,
  );
}

export async function stampV2PositionLetterSent(
  input: PositionLetterSentInput,
): Promise<void> {
  if (!flagEnabled()) return;
  return stampV2(
    "POSITION_LETTER_SENT",
    makePositionLetterSentPayload(input),
    input.sessionId,
  );
}

export async function stampV2LeaseExecuted(
  input: LeaseExecutedInput,
): Promise<void> {
  if (!flagEnabled()) return;
  const payload = makeLeaseExecutedPayload(input);
  // Applicant-scoped stamp — unchanged (subjectId = signerId drives the scope).
  await stampV2("LEASE_EXECUTED", payload, input.sessionId);
  // Unit-identity Phase B (WS-3): when the lease is tied to a unit, ALSO write
  // the same event onto that unit's chain (additive dual-write). A distinct
  // sessionId suffix keeps the unit row from colliding with the applicant row
  // on the (kind, session_id) idempotency key.
  if (input.unitId != null) {
    await stampV2(
      "LEASE_EXECUTED",
      payload,
      input.sessionId !== undefined ? `${input.sessionId}:unit` : undefined,
      { type: "unit", unitId: input.unitId },
    );
  }
}

/**
 * Unit-identity Phase B (WS-3): anchor a unit's identity onto its own chain.
 * Always unit-scoped — the explicit { type: "unit"; unitId } scope wins over the
 * (null) subjectId derivation. Lights up payload.bin + payload.unitId.
 */
export async function stampV2UnitIdentityAnchored(
  input: UnitIdentityAnchoredInput,
): Promise<void> {
  if (!flagEnabled()) return;
  return stampV2(
    "unit.identity_anchored",
    makeUnitIdentityAnchoredPayload(input),
    input.sessionId,
    { type: "unit", unitId: input.unitId },
  );
}

export async function stampV2ScreeningStateTransition(
  input: ScreeningStateTransitionInput,
): Promise<void> {
  if (!flagEnabled()) return;
  return stampV2(
    "screening.state_transition",
    makeScreeningStateTransitionPayload(input),
    input.sessionId,
  );
}
