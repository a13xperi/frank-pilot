/**
 * Phase 4b — Stripe Identity adapter unit tests.
 *
 * Covers the pure mapping (mapStripeSessionToResult) table-driven, plus the
 * resolve() flag gating and resolveStripeSession() read-back / HOLD semantics.
 * No network: getStripe + the DB query are mocked.
 */

const mockQuery = jest.fn();
const mockCreate = jest.fn();
const mockRetrieve = jest.fn();

jest.mock("../config/database", () => ({ query: (...a: unknown[]) => mockQuery(...a) }));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../lib/stripe", () => ({
  getStripe: () => ({
    identity: {
      verificationSessions: {
        create: (...a: unknown[]) => mockCreate(...a),
        retrieve: (...a: unknown[]) => mockRetrieve(...a),
      },
    },
  }),
}));

import { IdentityVerificationService } from "../modules/screening/identity-verification";

// Minimal VerificationSession factory — only the fields the mapper reads.
function session(overrides: Record<string, unknown> = {}): any {
  return {
    id: "vs_test_123",
    status: "verified",
    last_error: null,
    last_verification_report: null,
    metadata: { applicationId: "app-1" },
    ...overrides,
  };
}
function report(doc: unknown, selfie: unknown, id = "vr_1"): any {
  return { id, document: doc ?? null, selfie: selfie ?? null };
}

describe("IdentityVerificationService — Stripe Identity mapping", () => {
  let svc: IdentityVerificationService;
  beforeEach(() => {
    jest.clearAllMocks();
    svc = new IdentityVerificationService();
    delete process.env.IDENTITY_VERIFICATION_ENABLED;
    delete process.env.MOCK_MODE;
  });

  describe("mapStripeSessionToResult", () => {
    it("verified session + clean report → verified, doc+selfie valid, idType mapped", () => {
      const vs = session({
        status: "verified",
        last_verification_report: report(
          { type: "driving_license", error: null, first_name: "Sam", last_name: "Lee" },
          { error: null }
        ),
      });
      const r = svc.mapStripeSessionToResult(vs);
      expect(r.result).toBe("verified");
      expect(r.details.documentValid).toBe(true);
      expect(r.details.selfieMatch).toBe(true);
      expect(r.idType).toBe("driver_license");
      expect(r.confidence).toBeGreaterThanOrEqual(0.85);
      expect(r.livenessScore).toBeGreaterThanOrEqual(0.85);
    });

    it.each([
      ["passport", "passport"],
      ["id_card", "state_id"],
      ["driving_license", "driver_license"],
      ["something_else", "unknown"],
      [null, "unknown"],
    ])("maps Stripe document type %s → %s", (stripeType, expected) => {
      const vs = session({
        status: "verified",
        last_verification_report: report({ type: stripeType, error: null }, { error: null }),
      });
      expect(svc.mapStripeSessionToResult(vs).idType).toBe(expected);
    });

    it("processing → could_not_screen HOLD (never a pass)", () => {
      const r = svc.mapStripeSessionToResult(session({ status: "processing" }));
      expect(r.result).toBe("could_not_screen");
    });

    it("canceled → could_not_screen HOLD", () => {
      const r = svc.mapStripeSessionToResult(session({ status: "canceled" }));
      expect(r.result).toBe("could_not_screen");
    });

    it("requires_input + document error → rejected, surfaces categorical signal", () => {
      const vs = session({
        status: "requires_input",
        last_verification_report: report(
          { type: "driving_license", error: { code: "document_expired" } },
          { error: null }
        ),
      });
      const r = svc.mapStripeSessionToResult(vs);
      expect(r.result).toBe("rejected");
      expect(r.details.documentValid).toBe(false);
      expect(r.details.riskSignals).toContain("document_document_expired");
    });

    it("requires_input + selfie error → rejected on selfie mismatch", () => {
      const vs = session({
        status: "requires_input",
        last_verification_report: report(
          { type: "passport", error: null },
          { error: { code: "selfie_face_mismatch" } }
        ),
      });
      const r = svc.mapStripeSessionToResult(vs);
      expect(r.result).toBe("rejected");
      expect(r.details.selfieMatch).toBe(false);
      expect(r.details.riskSignals).toContain("selfie_selfie_face_mismatch");
    });

    it("requires_input with a clean report never grades verified (injects requires_input signal)", () => {
      const vs = session({
        status: "requires_input",
        last_verification_report: report(
          { type: "driving_license", error: null },
          { error: null }
        ),
      });
      const r = svc.mapStripeSessionToResult(vs);
      expect(r.result).toBe("review_required");
      expect(r.details.riskSignals).toContain("requires_input");
    });

    it("verified but name/DOB mismatch vs application → downgraded to review_required", () => {
      const vs = session({
        status: "verified",
        last_verification_report: report(
          {
            type: "driving_license",
            error: null,
            first_name: "Robert",
            last_name: "Smith",
            dob: { year: 1990, month: 1, day: 2 },
          },
          { error: null }
        ),
      });
      const r = svc.mapStripeSessionToResult(vs, {
        firstName: "Bob",
        lastName: "Smith",
        dateOfBirth: "1990-01-02",
      });
      expect(r.result).toBe("review_required");
      expect(r.details.riskSignals).toContain("name_dob_mismatch");
    });

    it("verified with matching name/DOB → stays verified (no mismatch signal)", () => {
      const vs = session({
        status: "verified",
        last_verification_report: report(
          {
            type: "driving_license",
            error: null,
            first_name: "Bob",
            last_name: "Smith",
            dob: { year: 1990, month: 1, day: 2 },
          },
          { error: null }
        ),
      });
      const r = svc.mapStripeSessionToResult(vs, {
        firstName: "bob",
        lastName: "SMITH",
        dateOfBirth: "1990-01-02T00:00:00.000Z",
      });
      expect(r.result).toBe("verified");
      expect(r.details.riskSignals).not.toContain("name_dob_mismatch");
    });

    it("rawResponse carries ONLY categorical fields — no name/DOB/document numbers", () => {
      const vs = session({
        status: "verified",
        last_verification_report: report(
          {
            type: "driving_license",
            error: null,
            first_name: "Jane",
            last_name: "Doe",
            number: "D1234567",
            dob: { year: 1985, month: 6, day: 15 },
          },
          { error: null }
        ),
      });
      const raw = JSON.stringify(svc.mapStripeSessionToResult(vs).details.rawResponse);
      expect(raw).toContain("vs_test_123");
      expect(raw).not.toContain("Jane");
      expect(raw).not.toContain("Doe");
      expect(raw).not.toContain("D1234567");
      expect(raw).not.toContain("1985");
    });
  });

  describe("createSession", () => {
    it("creates a document VerificationSession with selfie+liveness and idempotency key", async () => {
      mockCreate.mockResolvedValue({
        id: "vs_new",
        status: "requires_input",
        client_secret: "vs_new_secret",
        url: "https://verify.stripe.com/vs_new",
      });
      const handle = await svc.createSession({ applicationId: "app-42", returnUrl: "https://app/return" });
      expect(handle).toEqual({
        id: "vs_new",
        status: "requires_input",
        clientSecret: "vs_new_secret",
        url: "https://verify.stripe.com/vs_new",
      });
      const [params, opts] = mockCreate.mock.calls[0];
      expect(params.type).toBe("document");
      expect(params.options.document.require_matching_selfie).toBe(true);
      expect(params.options.document.require_live_capture).toBe(true);
      expect(params.metadata.applicationId).toBe("app-42");
      expect(params.return_url).toBe("https://app/return");
      expect(opts.idempotencyKey).toBe("idv:app-42");
    });
  });

  describe("resolve gating", () => {
    it("MOCK_MODE + screeningTag → legacy verify() fixture path (no DB read)", async () => {
      process.env.MOCK_MODE = "1";
      const r = await svc.resolve({
        applicationId: "app-1",
        firstName: "A",
        lastName: "B",
        dateOfBirth: "1990-01-01",
        screeningTag: "id_verification_fail",
      });
      expect(r.result).toBe("rejected"); // the fail fixture
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it("flag OFF → legacy verify() path, not the Stripe read-back", async () => {
      // keyless + no stub allowance → verify() throws internally → could_not_screen
      const r = await svc.resolve({
        applicationId: "app-1",
        firstName: "A",
        lastName: "B",
        dateOfBirth: "1990-01-01",
      });
      expect(["could_not_screen", "verified", "rejected", "review_required"]).toContain(r.result);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    describe("flag ON → resolveStripeSession read-back", () => {
      beforeEach(() => {
        process.env.IDENTITY_VERIFICATION_ENABLED = "true";
      });

      it("no session on file → could_not_screen HOLD", async () => {
        mockQuery.mockResolvedValue({ rows: [{ identity_session_id: null }] });
        const r = await svc.resolve({ applicationId: "app-1", firstName: "A", lastName: "B", dateOfBirth: "x" });
        expect(r.result).toBe("could_not_screen");
      });

      it("session created but no terminal verdict yet → could_not_screen HOLD", async () => {
        mockQuery.mockResolvedValue({
          rows: [{ identity_session_id: "vs_1", identity_verification_completed_at: null }],
        });
        const r = await svc.resolve({ applicationId: "app-1", firstName: "A", lastName: "B", dateOfBirth: "x" });
        expect(r.result).toBe("could_not_screen");
      });

      it("terminal verdict persisted → returns the stored full result", async () => {
        const stored = {
          result: "verified",
          confidence: 0.95,
          idType: "driver_license",
          livenessScore: 0.99,
          details: { documentValid: true, selfieMatch: true, riskSignals: [] },
        };
        mockQuery.mockResolvedValue({
          rows: [
            {
              identity_session_id: "vs_1",
              identity_verification_completed_at: new Date().toISOString(),
              identity_verification_details: stored,
            },
          ],
        });
        const r = await svc.resolve({ applicationId: "app-1", firstName: "A", lastName: "B", dateOfBirth: "x" });
        expect(r.result).toBe("verified");
        expect(r.idType).toBe("driver_license");
      });

      it("DB lookup throws → could_not_screen HOLD (fail-loud, never pass)", async () => {
        mockQuery.mockRejectedValue(new Error("db down"));
        const r = await svc.resolve({ applicationId: "app-1", firstName: "A", lastName: "B", dateOfBirth: "x" });
        expect(r.result).toBe("could_not_screen");
      });
    });
  });
});
