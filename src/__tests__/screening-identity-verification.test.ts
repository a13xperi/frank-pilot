/**
 * Tests for src/modules/screening/identity-verification.ts
 *
 * IdentityVerificationService is the first gate of runFullScreening (Persona
 * primary, Stripe Identity fallback). The wire-up into the pipeline is covered
 * by screening-service.test.ts; this file covers the service's own contract:
 *
 *   verify() → callIdentityAPI() (MOCK / stub / live path) → evaluateResults()
 *
 * Testing strategy mirrors screening-integrations.test.ts: spy on the private
 * callIdentityAPI to inject controlled vendor responses and exercise the full
 * evaluateResults decision matrix without any network call.
 *
 * Compliance contract (fail-loud, never a silent pass):
 *   - rejected         → document invalid / selfie mismatch / confidence|liveness < 0.5
 *   - review_required  → 0.5 ≤ score < 0.85, or any risk signals present
 *   - verified         → valid doc + selfie match + both scores ≥ 0.85 + no signals
 *   - A thrown API error or a blocked stub gate degrades to could_not_screen
 *     (held for staff review), NOT to verified — a misconfigured prod deploy must
 *     never auto-pass an applicant.
 */

import { IdentityVerificationService } from "../modules/screening/identity-verification";

jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// Control the stub-fallback gate per-test. Defaults to true (matching the
// NODE_ENV=test behaviour of the real policy) so the stub path is reachable;
// flipped to false in the production-safety tests.
jest.mock("../modules/screening/stub-policy", () => ({
  shouldUseScreeningStub: jest.fn(() => true),
  STUB_GATE_ERROR: "STUB_GATE_ERROR_SENTINEL",
}));

import { shouldUseScreeningStub } from "../modules/screening/stub-policy";

const mockShouldStub = shouldUseScreeningStub as jest.MockedFunction<
  typeof shouldUseScreeningStub
>;

// ── Input helper ────────────────────────────────────────────────────────────

function idInput(overrides: Record<string, unknown> = {}) {
  return {
    firstName: "Jane",
    lastName: "Doe",
    dateOfBirth: "1990-06-15",
    ...overrides,
  };
}

// A clean vendor response that evaluateResults grades as "verified".
function cleanResponse(overrides: Record<string, unknown> = {}) {
  return {
    documentValid: true,
    selfieMatch: true,
    confidence: 0.95,
    idType: "driver_license",
    livenessScore: 0.97,
    riskSignals: [],
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("IdentityVerificationService.verify()", () => {
  let service: IdentityVerificationService;

  beforeEach(() => {
    delete process.env.IDENTITY_API_KEY;
    delete process.env.MOCK_MODE;
    mockShouldStub.mockReturnValue(true);
    service = new IdentityVerificationService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.IDENTITY_API_KEY;
    delete process.env.MOCK_MODE;
  });

  // ── Stub path (no API key, stub allowed) ──────────────────────────────────

  it("returns verified via the stub path when no API key is configured", async () => {
    const result = await service.verify(idInput());

    expect(result.result).toBe("verified");
    expect(result.idType).toBe("driver_license");
    expect(result.confidence).toBe(0.95);
    expect(result.livenessScore).toBe(0.97);
    expect(result.details.documentValid).toBe(true);
    expect(result.details.selfieMatch).toBe(true);
    expect(result.details.riskSignals).toEqual([]);
  });

  // ── MOCK_MODE + screeningTag (backtest harness path) ──────────────────────

  it("MOCK_MODE + screeningTag=id_verification_fail returns rejected with risk signals", async () => {
    process.env.MOCK_MODE = "1";

    const result = await service.verify(idInput({ screeningTag: "id_verification_fail" }));

    expect(result.result).toBe("rejected");
    expect(result.details.documentValid).toBe(false);
    expect(result.details.selfieMatch).toBe(false);
    expect(result.details.riskSignals).toEqual(
      expect.arrayContaining(["selfie_no_match", "document_tampered"])
    );
    expect(result.confidence).toBeLessThan(0.5);
    expect(result.livenessScore).toBeLessThan(0.5);
  });

  it("MOCK_MODE + an unrecognized screeningTag returns the clean (verified) mock", async () => {
    process.env.MOCK_MODE = "1";

    const result = await service.verify(idInput({ screeningTag: "some_other_tag" }));

    expect(result.result).toBe("verified");
    expect(result.details.riskSignals).toEqual([]);
  });

  it("MOCK_MODE with no screeningTag falls through to the stub path (verified)", async () => {
    process.env.MOCK_MODE = "1";

    const result = await service.verify(idInput());

    expect(result.result).toBe("verified");
  });

  // ── evaluateResults decision matrix (spy on callIdentityAPI) ──────────────

  it("rejects when the document is invalid", async () => {
    jest.spyOn(service as any, "callIdentityAPI").mockResolvedValue(
      cleanResponse({ documentValid: false, riskSignals: ["document_expired"] })
    );

    const result = await service.verify(idInput());

    expect(result.result).toBe("rejected");
    expect(result.details.documentValid).toBe(false);
  });

  it("rejects when the selfie does not match", async () => {
    jest.spyOn(service as any, "callIdentityAPI").mockResolvedValue(
      cleanResponse({ selfieMatch: false, riskSignals: ["selfie_no_match"] })
    );

    const result = await service.verify(idInput());

    expect(result.result).toBe("rejected");
    expect(result.details.selfieMatch).toBe(false);
  });

  it("rejects when confidence is below 0.5", async () => {
    jest.spyOn(service as any, "callIdentityAPI").mockResolvedValue(
      cleanResponse({ confidence: 0.3 })
    );

    const result = await service.verify(idInput());

    expect(result.result).toBe("rejected");
    expect(result.confidence).toBe(0.3);
  });

  it("rejects when liveness score is below 0.5", async () => {
    jest.spyOn(service as any, "callIdentityAPI").mockResolvedValue(
      cleanResponse({ livenessScore: 0.4 })
    );

    const result = await service.verify(idInput());

    expect(result.result).toBe("rejected");
    expect(result.livenessScore).toBe(0.4);
  });

  it("review_required when confidence is in the 0.5–0.85 band", async () => {
    jest.spyOn(service as any, "callIdentityAPI").mockResolvedValue(
      cleanResponse({ confidence: 0.7 })
    );

    const result = await service.verify(idInput());

    expect(result.result).toBe("review_required");
  });

  it("review_required when liveness is in the 0.5–0.85 band", async () => {
    jest.spyOn(service as any, "callIdentityAPI").mockResolvedValue(
      cleanResponse({ livenessScore: 0.72 })
    );

    const result = await service.verify(idInput());

    expect(result.result).toBe("review_required");
  });

  it("review_required at the lower confidence boundary (exactly 0.5 is not a rejection)", async () => {
    jest.spyOn(service as any, "callIdentityAPI").mockResolvedValue(
      cleanResponse({ confidence: 0.5 })
    );

    const result = await service.verify(idInput());

    expect(result.result).toBe("review_required");
  });

  it("review_required when risk signals are present despite high scores", async () => {
    jest.spyOn(service as any, "callIdentityAPI").mockResolvedValue(
      cleanResponse({ riskSignals: ["name_mismatch"] })
    );

    const result = await service.verify(idInput());

    expect(result.result).toBe("review_required");
    expect(result.details.riskSignals).toEqual(["name_mismatch"]);
  });

  it("verified when doc valid + selfie matches + both scores ≥ 0.85 + no risk signals", async () => {
    jest.spyOn(service as any, "callIdentityAPI").mockResolvedValue(cleanResponse());

    const result = await service.verify(idInput());

    expect(result.result).toBe("verified");
  });

  it("verified at the exact 0.85 confidence/liveness threshold (boundary is inclusive)", async () => {
    jest.spyOn(service as any, "callIdentityAPI").mockResolvedValue(
      cleanResponse({ confidence: 0.85, livenessScore: 0.85 })
    );

    const result = await service.verify(idInput());

    expect(result.result).toBe("verified");
  });

  it("defaults idType to 'unknown' when the vendor response omits it", async () => {
    const resp = cleanResponse();
    delete (resp as any).idType;
    jest.spyOn(service as any, "callIdentityAPI").mockResolvedValue(resp);

    const result = await service.verify(idInput());

    expect(result.idType).toBe("unknown");
  });

  // ── Fail-safe: thrown errors never become a silent pass ───────────────────

  it("returns could_not_screen when the identity API throws (safe fallback, never a silent pass)", async () => {
    jest.spyOn(service as any, "callIdentityAPI").mockRejectedValue(
      new Error("Network timeout")
    );

    const result = await service.verify(idInput());

    expect(result.result).toBe("could_not_screen");
    expect(result.confidence).toBe(0);
    expect(result.livenessScore).toBe(0);
    expect(result.idType).toBe("unknown");
    expect(result.details.riskSignals).toContain("could_not_screen");
    expect(result.details.rawResponse).toMatchObject({
      error: expect.stringMatching(/could not screen/i),
    });
  });

  // ── Production safety: stub gate + un-wired live integration ──────────────

  it("callIdentityAPI throws the stub-gate error when no key is set and stub fallback is disabled", async () => {
    mockShouldStub.mockReturnValue(false);

    await expect(
      (service as any).callIdentityAPI(idInput())
    ).rejects.toThrow("STUB_GATE_ERROR_SENTINEL");
  });

  it("verify() fails safe to could_not_screen when the stub gate blocks (no silent pass in prod)", async () => {
    mockShouldStub.mockReturnValue(false);

    const result = await service.verify(idInput());

    // The gate throw is caught by verify()'s try/catch → could_not_screen, not verified.
    expect(result.result).toBe("could_not_screen");
    expect(result.details.riskSignals).toContain("could_not_screen");
  });

  it("fails safe to could_not_screen when a real key is set but live integration is not configured", async () => {
    // The key is read in the constructor, so build the service after setting it.
    process.env.IDENTITY_API_KEY = "live-persona-key";
    service = new IdentityVerificationService();

    const result = await service.verify(idInput());

    // callIdentityAPI throws "Production API integration not yet configured",
    // caught by verify() → could_not_screen (never verified).
    expect(result.result).toBe("could_not_screen");
    expect(result.details.riskSignals).toContain("could_not_screen");
  });

  it("a placeholder 'changeme' key is treated as no key (stub path)", async () => {
    process.env.IDENTITY_API_KEY = "changeme";
    service = new IdentityVerificationService();

    const result = await service.verify(idInput());

    expect(result.result).toBe("verified");
  });
});
