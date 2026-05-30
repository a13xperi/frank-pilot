/**
 * BP-02 Compliance Tape — unit test for the HUD_928_1_FAIR_HOUSING_POSTED maker.
 *
 * The maker is a pure function (no IO, no clock): same input → same JSON-LD.
 *
 * Regression guard (the load-bearing case): this event is PROPERTY-scoped, not
 * applicant-scoped. The TapeService routes a non-null payload.subjectId into
 * compliance_tape.applicant_id, which is an FK to users(id). A propertyId is
 * NOT a users(id), so subjectId MUST stay null here even when a propertyId is
 * supplied — otherwise the stamp silently FK-violates once
 * COMPLIANCE_TAPE_V2_ENABLED is on (stampSafe swallows the error). The
 * propertyId is preserved in evidence instead. Same contract/bug-class as the
 * #150 recert fix and the #221 screening-state-transition fix.
 */

import { makeHud9281FairHousingPostedPayload } from "../hud-928-1-fair-housing";
import { TAPE_CITATIONS } from "../../types";

describe("makeHud9281FairHousingPostedPayload()", () => {
  it("produces the canonical JSON-LD shape with the 24 CFR Part 110 citation", () => {
    const payload = makeHud9281FairHousingPostedPayload({
      propertyId: "prop-001",
      postedAt: "2026-05-22T10:00:00.000Z",
      medium: "web",
      sessionId: "sess-1",
    });

    expect(payload["@type"]).toBe("ComplianceEvent.Hud9281FairHousingPosted");
    expect(payload.actorId).toBeNull();
    expect(payload.ruleCitation).toBe(TAPE_CITATIONS.HUD_928_1_FAIR_HOUSING_POSTED);
    expect(payload.evidence).toEqual({
      postedAt: "2026-05-22T10:00:00.000Z",
      medium: "web",
      sessionId: "sess-1",
      propertyId: "prop-001",
    });
  });

  // ── FK-safety regression guard ──────────────────────────────────────────
  it("keeps subjectId null even when propertyId IS supplied (propertyId is not a users(id))", () => {
    const payload = makeHud9281FairHousingPostedPayload({
      propertyId: "prop-001",
      postedAt: "2026-05-22T10:00:00.000Z",
      medium: "office",
    });

    // The bug this guards: subjectId: propertyId ?? null routed a properties.id
    // into the users(id) FK column. subjectId must be null (global scope).
    expect(payload.subjectId).toBeNull();
    expect(payload.subjectId).not.toBe("prop-001");
    // …and the propertyId is not lost — it rides in evidence.
    expect((payload.evidence as Record<string, unknown>).propertyId).toBe("prop-001");
  });

  it("keeps subjectId null when propertyId is omitted (global-scope chain)", () => {
    const payload = makeHud9281FairHousingPostedPayload({
      postedAt: "2026-05-22T10:00:00.000Z",
      medium: "print",
    });

    expect(payload.subjectId).toBeNull();
    const ev = payload.evidence as Record<string, unknown>;
    expect(ev).not.toHaveProperty("propertyId");
    expect(ev).toEqual({
      postedAt: "2026-05-22T10:00:00.000Z",
      medium: "print",
    });
  });

  it("omits optional fields (sessionId, propertyId) when not supplied", () => {
    const payload = makeHud9281FairHousingPostedPayload({
      postedAt: "2026-05-22T10:00:00.000Z",
      medium: "web",
    });
    const ev = payload.evidence as Record<string, unknown>;

    expect(ev).not.toHaveProperty("sessionId");
    expect(ev).not.toHaveProperty("propertyId");
  });

  it("is pure — identical input yields a deep-equal payload", () => {
    const input = {
      propertyId: "prop-001",
      postedAt: "2026-05-22T10:00:00.000Z",
      medium: "web" as const,
    };
    expect(makeHud9281FairHousingPostedPayload(input)).toEqual(
      makeHud9281FairHousingPostedPayload(input)
    );
  });
});
