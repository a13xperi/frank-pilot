/**
 * Tests for src/modules/screening/background-check.ts
 *          and src/modules/screening/credit-check.ts
 *
 * Both services follow the same pattern:
 *   runCheck() → callXxxAPI() (private stub/live path) → evaluateResults() (private logic)
 *
 * Testing strategy: spy on the private callXxxAPI method to inject controlled
 * API responses, allowing full coverage of the evaluateResults decision logic
 * without depending on real network calls.
 *
 * Also tests the two real live paths exposed by environment config:
 *   - Stub path: no SCREENING_API_KEY → returns clean stub data
 *   - Error path: API throws → caught → returns could_not_screen (safe fallback)
 *
 * LIHTC/HUD/FCRA compliance notes:
 *   BackgroundCheckService: runs the HUD/FHA individualized-assessment engine
 *     (hud-criminal-decision.ts). Only federal MANDATORY floors auto-fail
 *     (§5.856 lifetime sex-offender registrant; §960.204 meth/current-drug/
 *     drug-eviction). DISCRETIONARY records (felonies, violent crimes) do NOT
 *     auto-fail — they become review_required tagged decision="individualized_review"
 *     so the orchestrator HOLDs them for a Castro §III.B assessment (never a
 *     time-blind blanket ban; never an auto-pass).
 *   CreditCheckService: auto-fail on evictions or active bankruptcy;
 *     sub-600 score → review_required (not auto-fail — decision matrix handles exceptions)
 */

import { BackgroundCheckService } from "../modules/screening/background-check";
import { CreditCheckService } from "../modules/screening/credit-check";

jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// ── Input helpers ──────────────────────────────────────────────────────────

function bgInput() {
  return {
    firstName: "Jane",
    lastName: "Doe",
    ssnLast4: "6789",
    dateOfBirth: "1990-06-15",
    state: "NV",
  };
}

function creditInput() {
  return {
    firstName: "Jane",
    lastName: "Doe",
    ssnLast4: "6789",
    dateOfBirth: "1990-06-15",
  };
}

// ── BackgroundCheckService ────────────────────────────────────────────────

describe("BackgroundCheckService.runCheck() — engine ON", () => {
  let service: BackgroundCheckService;

  beforeEach(() => {
    delete process.env.SCREENING_API_KEY;
    // These tests exercise the HUD/FHA individualized-assessment engine, which is
    // gated behind CRIMINAL_DECISION_ENGINE_ENABLED (default OFF). Turn it on so
    // the decision/citations/assessmentFactors keys are populated.
    process.env.CRIMINAL_DECISION_ENGINE_ENABLED = "true";
    service = new BackgroundCheckService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.SCREENING_API_KEY;
    delete process.env.CRIMINAL_DECISION_ENGINE_ENABLED;
  });

  // ── Stub path (no API key) ───────────────────────────────────────────────

  it("returns pass when stub path returns clean record (no felonies, no offenses)", async () => {
    // No API key → stub always returns clean record
    const result = await service.runCheck(bgInput());

    expect(result.result).toBe("pass");
    expect(result.details.decision).toBe("clear");
    expect(result.details.felonies).toBe(0);
    expect(result.details.sexOffenses).toBe(false);
    expect(result.details.violentCrimes).toBe(false);
    expect(result.details.misdemeanors).toBe(0);
    expect(result.details.riskScore).toBe(0);
  });

  // ── evaluateResults() via spy ────────────────────────────────────────────

  it("HOLDs felonies for individualized assessment — does NOT auto-fail (HUD/FHA)", async () => {
    // Felonies are DISCRETIONARY: Castro §III forbids a time-blind blanket ban.
    // The engine routes them to a review_required HOLD tagged for individualized
    // assessment, never a "fail".
    jest.spyOn(service as any, "callScreeningAPI").mockResolvedValue({
      felonies: 2,
      sexOffenses: false,
      violentCrimes: false,
      misdemeanors: [],
    });

    const result = await service.runCheck(bgInput());

    expect(result.result).toBe("review_required");
    expect(result.details.decision).toBe("individualized_review");
    expect(result.details.felonies).toBe(2);
    expect(result.details.riskScore).toBe(90);
    expect(result.details.assessmentFactors?.mitigatingEvidenceRequired).toBe(true);
    expect(result.details.citations).toEqual(
      expect.arrayContaining([expect.stringMatching(/100\.500|Castro/)])
    );
  });

  it("auto-fails a sex-offender registry hit (§5.856 mandatory floor)", async () => {
    // §5.856 lifetime registrant is one of the few MANDATORY federal denials —
    // it is the exception that still auto-fails (no individualized assessment).
    jest.spyOn(service as any, "callScreeningAPI").mockResolvedValue({
      felonies: 0,
      sexOffenses: true,
      violentCrimes: false,
      misdemeanors: [],
    });

    const result = await service.runCheck(bgInput());

    expect(result.result).toBe("fail");
    expect(result.details.decision).toBe("mandatory_denial");
    expect(result.details.sexOffenses).toBe(true);
    expect(result.details.riskScore).toBe(100);
    expect(result.details.citations).toEqual(
      expect.arrayContaining([expect.stringMatching(/5\.856/)])
    );
  });

  it("HOLDs violent crimes for individualized assessment — does NOT auto-fail", async () => {
    jest.spyOn(service as any, "callScreeningAPI").mockResolvedValue({
      felonies: 0,
      sexOffenses: false,
      violentCrimes: true,
      misdemeanors: [],
    });

    const result = await service.runCheck(bgInput());

    expect(result.result).toBe("review_required");
    expect(result.details.decision).toBe("individualized_review");
    expect(result.details.violentCrimes).toBe(true);
    expect(result.details.riskScore).toBe(90);
  });

  it("returns review_required when misdemeanor count >= 3 (riskScore=75, soft-clear)", async () => {
    // Misdemeanors are NOT a denial-consideration trigger in the engine
    // (decision stays "clear"); the legacy soft-risk score still routes 3+ to a
    // review_required passthrough (auto-pass), distinct from an IA hold.
    jest.spyOn(service as any, "callScreeningAPI").mockResolvedValue({
      felonies: 0,
      sexOffenses: false,
      violentCrimes: false,
      misdemeanors: ["DUI", "disorderly_conduct", "petty_theft"],
    });

    const result = await service.runCheck(bgInput());

    expect(result.result).toBe("review_required");
    expect(result.details.decision).toBe("clear");
    expect(result.details.misdemeanors).toBe(3);
    expect(result.details.riskScore).toBe(75);
  });

  it("returns pass with riskScore=50 for 2 misdemeanors (below review threshold)", async () => {
    jest.spyOn(service as any, "callScreeningAPI").mockResolvedValue({
      felonies: 0,
      sexOffenses: false,
      violentCrimes: false,
      misdemeanors: ["DUI", "petty_theft"],
    });

    const result = await service.runCheck(bgInput());

    expect(result.result).toBe("pass");
    expect(result.details.misdemeanors).toBe(2);
    expect(result.details.riskScore).toBe(50);
  });

  it("returns pass with riskScore=25 for 1 misdemeanor", async () => {
    jest.spyOn(service as any, "callScreeningAPI").mockResolvedValue({
      felonies: 0,
      sexOffenses: false,
      violentCrimes: false,
      misdemeanors: ["minor_traffic"],
    });

    const result = await service.runCheck(bgInput());

    expect(result.result).toBe("pass");
    expect(result.details.riskScore).toBe(25);
  });

  it("returns could_not_screen with riskScore=-1 when the screening API throws (safe fallback)", async () => {
    jest.spyOn(service as any, "callScreeningAPI").mockRejectedValue(
      new Error("Network timeout")
    );

    const result = await service.runCheck(bgInput());

    expect(result.result).toBe("could_not_screen");
    expect(result.details.riskScore).toBe(-1);
    expect(result.details.rawResponse).toMatchObject({
      error: expect.stringMatching(/could not screen/i),
    });
  });

  it("propagates all detail fields (felonies, sexOffenses, violentCrimes, misdemeanors) in result", async () => {
    jest.spyOn(service as any, "callScreeningAPI").mockResolvedValue({
      felonies: 1,
      sexOffenses: false,
      violentCrimes: false,
      misdemeanors: ["DUI"],
    });

    const result = await service.runCheck(bgInput());

    expect(result.details).toMatchObject({
      felonies: 1,
      sexOffenses: false,
      violentCrimes: false,
      misdemeanors: 1,
    });
  });

  it("sets misdemeanor riskScore=0 for zero misdemeanors (clean pass)", async () => {
    jest.spyOn(service as any, "callScreeningAPI").mockResolvedValue({
      felonies: 0,
      sexOffenses: false,
      violentCrimes: false,
      misdemeanors: [],
    });

    const result = await service.runCheck(bgInput());

    expect(result.result).toBe("pass");
    expect(result.details.riskScore).toBe(0);
  });
});

// ── BackgroundCheckService — engine OFF (default) ──────────────────────────
// CRIMINAL_DECISION_ENGINE_ENABLED defaults OFF. With the flag off the service
// must run the pre-engine blanket-ban path and write NONE of the engine keys
// (decision / citations / reasons / assessmentFactors) into details — i.e. it is
// byte-identical to the historical behaviour. This is the dark-merge guard: the
// engine merged + deployed must change nothing until the flag is deliberately on.

describe("BackgroundCheckService.runCheck() — engine OFF (legacy, byte-identical)", () => {
  let service: BackgroundCheckService;

  beforeEach(() => {
    delete process.env.SCREENING_API_KEY;
    delete process.env.CRIMINAL_DECISION_ENGINE_ENABLED; // explicit default-OFF
    service = new BackgroundCheckService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.SCREENING_API_KEY;
    delete process.env.CRIMINAL_DECISION_ENGINE_ENABLED;
  });

  function expectNoEngineKeys(details: any) {
    expect(details).not.toHaveProperty("decision");
    expect(details).not.toHaveProperty("reasons");
    expect(details).not.toHaveProperty("citations");
    expect(details).not.toHaveProperty("assessmentFactors");
  }

  it("clean stub record → pass, no engine keys", async () => {
    const result = await service.runCheck(bgInput());

    expect(result.result).toBe("pass");
    expect(result.details.riskScore).toBe(0);
    expectNoEngineKeys(result.details);
  });

  it("felonies → blanket auto-fail (legacy), riskScore=100, no engine keys", async () => {
    // The legacy path is exactly the time-blind ban the engine is meant to
    // replace — flag-off it must still behave that way, byte-identical.
    jest.spyOn(service as any, "callScreeningAPI").mockResolvedValue({
      felonies: 2,
      sexOffenses: false,
      violentCrimes: false,
      misdemeanors: [],
    });

    const result = await service.runCheck(bgInput());

    expect(result.result).toBe("fail");
    expect(result.details.felonies).toBe(2);
    expect(result.details.riskScore).toBe(100);
    expectNoEngineKeys(result.details);
  });

  it("sex offense → blanket auto-fail (legacy), no engine keys", async () => {
    jest.spyOn(service as any, "callScreeningAPI").mockResolvedValue({
      felonies: 0,
      sexOffenses: true,
      violentCrimes: false,
      misdemeanors: [],
    });

    const result = await service.runCheck(bgInput());

    expect(result.result).toBe("fail");
    expect(result.details.riskScore).toBe(100);
    expectNoEngineKeys(result.details);
  });

  it("violent crime → blanket auto-fail (legacy), no engine keys", async () => {
    jest.spyOn(service as any, "callScreeningAPI").mockResolvedValue({
      felonies: 0,
      sexOffenses: false,
      violentCrimes: true,
      misdemeanors: [],
    });

    const result = await service.runCheck(bgInput());

    expect(result.result).toBe("fail");
    expect(result.details.riskScore).toBe(100);
    expectNoEngineKeys(result.details);
  });

  it("3 misdemeanors → review_required (soft-risk 75), no engine keys", async () => {
    jest.spyOn(service as any, "callScreeningAPI").mockResolvedValue({
      felonies: 0,
      sexOffenses: false,
      violentCrimes: false,
      misdemeanors: ["DUI", "disorderly_conduct", "petty_theft"],
    });

    const result = await service.runCheck(bgInput());

    expect(result.result).toBe("review_required");
    expect(result.details.misdemeanors).toBe(3);
    expect(result.details.riskScore).toBe(75);
    expectNoEngineKeys(result.details);
  });

  it("2 misdemeanors → pass (soft-risk 50), no engine keys", async () => {
    jest.spyOn(service as any, "callScreeningAPI").mockResolvedValue({
      felonies: 0,
      sexOffenses: false,
      violentCrimes: false,
      misdemeanors: ["DUI", "petty_theft"],
    });

    const result = await service.runCheck(bgInput());

    expect(result.result).toBe("pass");
    expect(result.details.riskScore).toBe(50);
    expectNoEngineKeys(result.details);
  });

  it("API throws → could_not_screen HOLD even with engine off (fail-loud unaffected)", async () => {
    jest.spyOn(service as any, "callScreeningAPI").mockRejectedValue(
      new Error("Network timeout")
    );

    const result = await service.runCheck(bgInput());

    expect(result.result).toBe("could_not_screen");
    expect(result.details.riskScore).toBe(-1);
  });
});

// ── CreditCheckService ────────────────────────────────────────────────────

describe("CreditCheckService.runCheck()", () => {
  let service: CreditCheckService;

  beforeEach(() => {
    delete process.env.SCREENING_API_KEY;
    service = new CreditCheckService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.SCREENING_API_KEY;
  });

  // ── Stub path ────────────────────────────────────────────────────────────

  it("returns pass with creditScore=680 via stub path (no API key)", async () => {
    const result = await service.runCheck(creditInput());

    expect(result.result).toBe("pass");
    expect(result.creditScore).toBe(680);
    expect(result.details.evictions).toBe(0);
    expect(result.details.bankruptcies).toBe(0);
    expect(result.details.collections).toBe(0);
  });

  // ── evaluateResults() via spy ────────────────────────────────────────────

  it("returns fail when evictions > 0 (FCRA auto-fail)", async () => {
    jest.spyOn(service as any, "callCreditAPI").mockResolvedValue({
      creditScore: 650,
      paymentHistory: "good",
      outstandingDebts: 1000,
      collections: 0,
      evictions: 1,
      bankruptcies: 0,
    });

    const result = await service.runCheck(creditInput());

    expect(result.result).toBe("fail");
    expect(result.details.evictions).toBe(1);
  });

  it("returns fail when bankruptcies > 0 (auto-fail)", async () => {
    jest.spyOn(service as any, "callCreditAPI").mockResolvedValue({
      creditScore: 500,
      paymentHistory: "poor",
      outstandingDebts: 15000,
      collections: 2,
      evictions: 0,
      bankruptcies: 1,
    });

    const result = await service.runCheck(creditInput());

    expect(result.result).toBe("fail");
    expect(result.details.bankruptcies).toBe(1);
  });

  it("returns pass for creditScore exactly at threshold (600)", async () => {
    jest.spyOn(service as any, "callCreditAPI").mockResolvedValue({
      creditScore: 600,
      paymentHistory: "fair",
      outstandingDebts: 3000,
      collections: 0,
      evictions: 0,
      bankruptcies: 0,
    });

    const result = await service.runCheck(creditInput());

    expect(result.result).toBe("pass");
    expect(result.creditScore).toBe(600);
  });

  it("returns pass for creditScore above threshold (720)", async () => {
    jest.spyOn(service as any, "callCreditAPI").mockResolvedValue({
      creditScore: 720,
      paymentHistory: "excellent",
      outstandingDebts: 500,
      collections: 0,
      evictions: 0,
      bankruptcies: 0,
    });

    const result = await service.runCheck(creditInput());

    expect(result.result).toBe("pass");
    expect(result.creditScore).toBe(720);
  });

  it("returns review_required for creditScore just below threshold (599) — decision matrix handles exceptions", async () => {
    jest.spyOn(service as any, "callCreditAPI").mockResolvedValue({
      creditScore: 599,
      paymentHistory: "fair",
      outstandingDebts: 4000,
      collections: 1,
      evictions: 0,
      bankruptcies: 0,
    });

    const result = await service.runCheck(creditInput());

    // LIHTC compliance: sub-600 is NOT auto-fail — decision matrix allows exceptions
    expect(result.result).toBe("review_required");
    expect(result.creditScore).toBe(599);
  });

  it("returns review_required for very low creditScore (450)", async () => {
    jest.spyOn(service as any, "callCreditAPI").mockResolvedValue({
      creditScore: 450,
      paymentHistory: "poor",
      outstandingDebts: 8000,
      collections: 3,
      evictions: 0,
      bankruptcies: 0,
    });

    const result = await service.runCheck(creditInput());

    expect(result.result).toBe("review_required");
    expect(result.creditScore).toBe(450);
  });

  it("returns could_not_screen with creditScore=0 when the credit API throws (safe fallback)", async () => {
    jest.spyOn(service as any, "callCreditAPI").mockRejectedValue(
      new Error("Credit bureau timeout")
    );

    const result = await service.runCheck(creditInput());

    expect(result.result).toBe("could_not_screen");
    expect(result.creditScore).toBe(0);
    expect(result.details.rawResponse).toMatchObject({
      error: expect.stringMatching(/could not screen/i),
    });
  });

  it("propagates all detail fields in result", async () => {
    jest.spyOn(service as any, "callCreditAPI").mockResolvedValue({
      creditScore: 720,
      paymentHistory: "good",
      outstandingDebts: 1500,
      collections: 0,
      evictions: 0,
      bankruptcies: 0,
    });

    const result = await service.runCheck(creditInput());

    expect(result.details).toMatchObject({
      paymentHistory: "good",
      outstandingDebts: 1500,
      collections: 0,
      evictions: 0,
      bankruptcies: 0,
    });
  });

  it("evictions take priority over low credit score (fail beats review_required)", async () => {
    jest.spyOn(service as any, "callCreditAPI").mockResolvedValue({
      creditScore: 400,   // would be review_required on its own
      paymentHistory: "poor",
      outstandingDebts: 0,
      collections: 0,
      evictions: 2,       // auto-fail
      bankruptcies: 0,
    });

    const result = await service.runCheck(creditInput());

    expect(result.result).toBe("fail");
    expect(result.details.evictions).toBe(2);
  });
});
