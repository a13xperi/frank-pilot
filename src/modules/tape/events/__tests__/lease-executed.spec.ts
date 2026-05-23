/**
 * BP-02 Compliance Tape — unit test for the LEASE_EXECUTED payload maker.
 *
 * The maker is a pure function (no IO, no clock): same input → same JSON-LD.
 * We assert the canonical shape, the ESIGN/UETA citation, and that the
 * optional tamper-evidence fields are omitted when not supplied.
 */

import { makeLeaseExecutedPayload } from "../lease-executed";
import { TAPE_CITATIONS } from "../../types";

const base = {
  applicationId: "app-001",
  signerId: "user-tenant",
  signerName: "Jane Doe",
  signedAt: "2026-05-22T10:00:00.000Z",
  consentAt: "2026-05-22T10:00:00.000Z",
};

describe("makeLeaseExecutedPayload()", () => {
  it("produces the canonical JSON-LD shape with the ESIGN citation", () => {
    const payload = makeLeaseExecutedPayload({
      ...base,
      signerIp: "203.0.113.7",
      documentHash: "abc123",
      sessionId: "sess-1",
    });

    expect(payload["@type"]).toBe("ComplianceEvent.LeaseExecuted");
    expect(payload.actorId).toBe("user-tenant");
    // subjectId is the per-applicant tape scope key (FK'd to users), so it is
    // the signer's user id — the applicationId lives in evidence.
    expect(payload.subjectId).toBe("user-tenant");
    expect(payload.ruleCitation).toBe(TAPE_CITATIONS.LEASE_EXECUTED);
    expect(payload.evidence).toEqual({
      applicationId: "app-001",
      signerId: "user-tenant",
      signerName: "Jane Doe",
      signedAt: "2026-05-22T10:00:00.000Z",
      consentAt: "2026-05-22T10:00:00.000Z",
      signerIp: "203.0.113.7",
      documentHash: "abc123",
      sessionId: "sess-1",
    });
  });

  it("omits optional fields (signerIp, documentHash, sessionId) when not supplied", () => {
    const payload = makeLeaseExecutedPayload(base);
    const ev = payload.evidence as Record<string, unknown>;

    expect(ev).not.toHaveProperty("signerIp");
    expect(ev).not.toHaveProperty("documentHash");
    expect(ev).not.toHaveProperty("sessionId");
    expect(ev).toEqual({
      applicationId: "app-001",
      signerId: "user-tenant",
      signerName: "Jane Doe",
      signedAt: "2026-05-22T10:00:00.000Z",
      consentAt: "2026-05-22T10:00:00.000Z",
    });
  });

  it("is pure — identical input yields a deep-equal payload", () => {
    expect(makeLeaseExecutedPayload(base)).toEqual(makeLeaseExecutedPayload(base));
  });
});
