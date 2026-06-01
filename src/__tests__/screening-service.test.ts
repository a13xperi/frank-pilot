/**
 * Tests for src/modules/screening/service.ts
 *
 * Validates the full automated screening pipeline orchestration:
 * background check + credit check + tax credit compliance running in
 * parallel, and the result aggregation rules that gate every application
 * into the approval workflow.
 *
 * Compliance notes:
 * - Any single "fail" → overall fail (FCRA adverse-action requirement).
 * - Any "review_required" (no fail) → escalates to human review (HUD/LIHTC).
 * - All pass → screening_passed, eligible for Tier 1 approval.
 * - Decrypted SSN/DOB never stored in plaintext (PCI-DSS / FCRA).
 */

import { ScreeningService } from "../modules/screening/service";

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock("../config/database", () => ({ query: jest.fn() }));
jest.mock("../middleware/audit", () => ({ writeAuditLog: jest.fn() }));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../utils/encryption", () => ({
  decrypt: jest.fn((v: string) => `decrypted:${v}`),
}));

jest.mock("../modules/screening/background-check", () => ({
  BackgroundCheckService: jest.fn().mockImplementation(() => ({
    runCheck: jest.fn(),
  })),
}));

jest.mock("../modules/screening/credit-check", () => ({
  CreditCheckService: jest.fn().mockImplementation(() => ({
    runCheck: jest.fn(),
  })),
}));

jest.mock("../modules/screening/compliance", () => ({
  ComplianceService: jest.fn().mockImplementation(() => ({
    runCheck: jest.fn(),
  })),
}));

jest.mock("../modules/screening/identity-verification", () => ({
  IdentityVerificationService: jest.fn().mockImplementation(() => ({
    // resolve() is the screening-time entry point (Phase 4b). verify() is kept
    // mocked too since the real class still exports it (legacy/MOCK path).
    resolve: jest.fn(),
    verify: jest.fn(),
  })),
}));

jest.mock("../modules/screening/fraud-detection", () => ({
  FraudDetectionService: jest.fn().mockImplementation(() => ({
    checkDuplicateSSN: jest.fn().mockResolvedValue({ existingApplicationIds: [] }),
    checkAddressFraud: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock("../modules/adverse-action/service", () => ({
  AdverseActionService: jest.fn().mockImplementation(() => ({
    sendNotice: jest.fn().mockResolvedValue({
      noticeId: "notice-001",
      applicationId: "app-001",
      sentAt: new Date(),
      reason: "screening_failed",
    }),
    generateNoticeDraft: jest.fn().mockResolvedValue({
      applicationId: "app-001",
      applicantName: "Jane Doe",
      propertyName: "Desert Oasis Apartments",
      noticeText: "DRAFT FCRA NOTICE TEXT",
    }),
  })),
}));

jest.mock("../modules/screening/state-machine", () => ({
  transitionApplicationStatus: jest.fn(),
}));

import { query } from "../config/database";
import { writeAuditLog } from "../middleware/audit";
import { decrypt } from "../utils/encryption";
import { BackgroundCheckService } from "../modules/screening/background-check";
import { CreditCheckService } from "../modules/screening/credit-check";
import { ComplianceService } from "../modules/screening/compliance";
import { IdentityVerificationService } from "../modules/screening/identity-verification";
import { AdverseActionService } from "../modules/adverse-action/service";
import { transitionApplicationStatus } from "../modules/screening/state-machine";

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockAuditLog = writeAuditLog as jest.MockedFunction<typeof writeAuditLog>;
const mockDecrypt = decrypt as jest.MockedFunction<typeof decrypt>;
const mockTransition = transitionApplicationStatus as jest.MockedFunction<
  typeof transitionApplicationStatus
>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeApp(overrides: Record<string, unknown> = {}) {
  return {
    id: "app-001",
    status: "submitted",
    first_name: "Jane",
    last_name: "Doe",
    ssn_encrypted: "enc-ssn",
    date_of_birth_encrypted: "enc-dob",
    current_state: "MA",
    property_id: "prop-001",
    annual_income: "40000",
    ...overrides,
  };
}

function makeBackgroundResult(result: "pass" | "fail" | "review_required" | "could_not_screen") {
  return {
    result,
    details: {
      felonies: 0, sexOffenses: false, violentCrimes: false,
      misdemeanors: 0, riskScore: 10,
    },
  } as any;
}

function makeCreditResult(
  result: "pass" | "fail" | "review_required" | "could_not_screen",
  score = 700
) {
  return {
    result,
    creditScore: score,
    details: {
      creditScore: score, paymentHistory: "good", outstandingDebts: 0,
      collections: 0, evictions: 0, bankruptcies: 0,
    },
  } as any;
}

function makeComplianceResult(result: "pass" | "fail" | "review_required") {
  return {
    result,
    details: {
      incomeWithinLimits: result === "pass",
      applicableAMILimit: 50000,
      householdIncome: 40000,
      amiPercentage: 80,
      assetVerification: "not_provided",
      regulatoryNotes: [],
    },
  } as any;
}

function makeIdentityResult(result: "verified" | "rejected" | "review_required") {
  const confidence = result === "verified" ? 0.95 : result === "rejected" ? 0.21 : 0.7;
  const liveness = result === "verified" ? 0.97 : result === "rejected" ? 0.34 : 0.72;
  return {
    result,
    confidence,
    idType: "driver_license",
    livenessScore: liveness,
    details: {
      documentValid: result !== "rejected",
      selfieMatch: result !== "rejected",
      riskSignals: result === "rejected" ? ["selfie_no_match", "document_tampered"] : [],
    },
  } as any;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ScreeningService.runFullScreening", () => {
  let service: ScreeningService;
  let mockIdentity: jest.Mocked<InstanceType<typeof IdentityVerificationService>>;
  let mockBackground: jest.Mocked<InstanceType<typeof BackgroundCheckService>>;
  let mockCredit: jest.Mocked<InstanceType<typeof CreditCheckService>>;
  let mockCompliance: jest.Mocked<InstanceType<typeof ComplianceService>>;
  let mockAdverseAction: jest.Mocked<InstanceType<typeof AdverseActionService>>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuditLog.mockResolvedValue(undefined);
    mockDecrypt.mockImplementation((v: string) => `decrypted:${v}`);
    mockTransition.mockResolvedValue({ changed: true, status: "screening_passed" } as any);

    service = new ScreeningService();

    // Grab the instances created inside the constructor
    mockIdentity = (service as any).identity;
    mockBackground = (service as any).backgroundCheck;
    mockCredit = (service as any).creditCheck;
    mockCompliance = (service as any).compliance;
    mockAdverseAction = (service as any).adverseAction;

    // Default: identity verified + all vendor checks pass
    mockIdentity.resolve.mockResolvedValue(makeIdentityResult("verified"));
    mockBackground.runCheck.mockResolvedValue(makeBackgroundResult("pass"));
    mockCredit.runCheck.mockResolvedValue(makeCreditResult("pass"));
    mockCompliance.runCheck.mockResolvedValue(makeComplianceResult("pass"));

    // Default query: app found + subsequent UPDATEs succeed
    mockQuery
      .mockResolvedValueOnce({ rows: [makeApp()] } as any) // SELECT application
      .mockResolvedValue({ rows: [] } as any);              // identity persist + UPDATEs
  });

  // ── Guard: application not found / wrong status ───────────────────────────

  it("throws when application is not found or not in submitted/screening status", async () => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);

    await expect(
      service.runFullScreening("app-missing", "user-1", "leasing_agent")
    ).rejects.toThrow(/not found or not in submitted\/screening status/i);
  });

  // ── All-pass scenario ─────────────────────────────────────────────────────

  it("returns overallResult=pass when all three checks pass", async () => {
    const result = await service.runFullScreening("app-001", "user-1", "leasing_agent");

    expect(result.overallResult).toBe("pass");
  });

  it("transitions to screening_passed (all_checks_passed) when overallResult is pass", async () => {
    await service.runFullScreening("app-001", "user-1", "leasing_agent");

    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({ to: "screening_passed", trigger: "all_checks_passed" })
    );
  });

  // ── Fail propagation ──────────────────────────────────────────────────────

  it("returns overallResult=fail when background check fails", async () => {
    mockBackground.runCheck.mockResolvedValue(makeBackgroundResult("fail"));

    const result = await service.runFullScreening("app-001", "user-1", "leasing_agent");

    expect(result.overallResult).toBe("fail");
  });

  it("returns overallResult=fail when credit check fails", async () => {
    mockCredit.runCheck.mockResolvedValue(makeCreditResult("fail"));

    const result = await service.runFullScreening("app-001", "user-1", "leasing_agent");

    expect(result.overallResult).toBe("fail");
  });

  it("returns overallResult=fail when compliance check fails", async () => {
    mockCompliance.runCheck.mockResolvedValue(makeComplianceResult("fail"));

    const result = await service.runFullScreening("app-001", "user-1", "leasing_agent");

    expect(result.overallResult).toBe("fail");
  });

  it("transitions to screening_failed (any_check_failed) when overallResult is fail", async () => {
    mockBackground.runCheck.mockResolvedValue(makeBackgroundResult("fail"));

    await service.runFullScreening("app-001", "user-1", "leasing_agent");

    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({ to: "screening_failed", trigger: "any_check_failed" })
    );
  });

  it("does NOT send the FCRA notice when the final transition loses the CAS (changed:false)", async () => {
    mockBackground.runCheck.mockResolvedValue(makeBackgroundResult("fail"));
    mockTransition.mockResolvedValue({ changed: false, status: "screening_failed" } as any);

    await service.runFullScreening("app-001", "user-1", "leasing_agent");

    expect(mockAdverseAction.sendNotice).not.toHaveBeenCalled();
  });

  // ── Review-required escalation ────────────────────────────────────────────

  it("returns overallResult=review_required when background is review_required (no fails)", async () => {
    mockBackground.runCheck.mockResolvedValue(makeBackgroundResult("review_required"));

    const result = await service.runFullScreening("app-001", "user-1", "leasing_agent");

    expect(result.overallResult).toBe("review_required");
  });

  it("returns overallResult=review_required when all three are review_required", async () => {
    mockBackground.runCheck.mockResolvedValue(makeBackgroundResult("review_required"));
    mockCredit.runCheck.mockResolvedValue(makeCreditResult("review_required"));
    mockCompliance.runCheck.mockResolvedValue(makeComplianceResult("review_required"));

    const result = await service.runFullScreening("app-001", "user-1", "leasing_agent");

    expect(result.overallResult).toBe("review_required");
  });

  it("fail takes precedence over review_required", async () => {
    mockBackground.runCheck.mockResolvedValue(makeBackgroundResult("fail"));
    mockCredit.runCheck.mockResolvedValue(makeCreditResult("review_required"));
    mockCompliance.runCheck.mockResolvedValue(makeComplianceResult("review_required"));

    const result = await service.runFullScreening("app-001", "user-1", "leasing_agent");

    expect(result.overallResult).toBe("fail");
  });

  // ── could_not_screen: misconfigured / failed pipeline HOLDS, never passes ──
  //
  // CRITICAL ENV NUANCE: under jest NODE_ENV='test', shouldUseScreeningStub()
  // returns TRUE, so the STUB_GATE_ERROR throw inside the vendor never fires and
  // the per-check catch is NOT reached by default — the stub gate is OPEN. To
  // exercise the could_not_screen path we simulate the infra failure at the
  // vendor boundary directly: force a vendor's runCheck to RESOLVE with
  // could_not_screen (the value its own catch block now returns), or REJECT to
  // hit the catch. We use the already-mocked runCheck (see jest.mock above) the
  // same way every other vendor-result test in this file does.

  it("returns overallResult=could_not_screen when background could_not_screen (no fails)", async () => {
    mockBackground.runCheck.mockResolvedValue(makeBackgroundResult("could_not_screen"));

    const result = await service.runFullScreening("app-001", "user-1", "leasing_agent");

    expect(result.overallResult).toBe("could_not_screen");
  });

  it("could_not_screen takes precedence over review_required (a held check is not a borderline pass)", async () => {
    mockBackground.runCheck.mockResolvedValue(makeBackgroundResult("could_not_screen"));
    mockCredit.runCheck.mockResolvedValue(makeCreditResult("review_required"));
    mockCompliance.runCheck.mockResolvedValue(makeComplianceResult("review_required"));

    const result = await service.runFullScreening("app-001", "user-1", "leasing_agent");

    expect(result.overallResult).toBe("could_not_screen");
  });

  it("fail takes precedence over could_not_screen (a real denial still wins)", async () => {
    mockBackground.runCheck.mockResolvedValue(makeBackgroundResult("fail"));
    mockCredit.runCheck.mockResolvedValue(makeCreditResult("could_not_screen"));

    const result = await service.runFullScreening("app-001", "user-1", "leasing_agent");

    expect(result.overallResult).toBe("fail");
  });

  it("a could-not-screen pipeline lands in screening_review (could_not_screen), NEVER screening_passed", async () => {
    mockBackground.runCheck.mockResolvedValue(makeBackgroundResult("could_not_screen"));

    await service.runFullScreening("app-001", "user-1", "leasing_agent");

    // HOLD, not a pass: routes through the chokepoint into the new review state.
    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({ to: "screening_review", trigger: "could_not_screen" })
    );
    // It must NEVER have attempted to mark the app passed.
    expect(mockTransition).not.toHaveBeenCalledWith(
      expect.objectContaining({ to: "screening_passed" })
    );
  });

  it("persists overall_screening_result='could_not_screen' for a held pipeline", async () => {
    mockBackground.runCheck.mockResolvedValue(makeBackgroundResult("could_not_screen"));

    await service.runFullScreening("app-001", "user-1", "leasing_agent");

    // The aggregate-result UPDATE writes the overallResult value verbatim.
    const wroteCouldNotScreen = mockQuery.mock.calls.some(
      ([sql, params]) =>
        typeof sql === "string" &&
        /SET overall_screening_result = \$2/.test(sql) &&
        Array.isArray(params) &&
        params[1] === "could_not_screen"
    );
    expect(wroteCouldNotScreen).toBe(true);
  });

  it("sends NO adverse-action notice for could_not_screen (it is a hold, not a denial)", async () => {
    mockBackground.runCheck.mockResolvedValue(makeBackgroundResult("could_not_screen"));

    await service.runFullScreening("app-001", "user-1", "leasing_agent");

    expect(mockAdverseAction.sendNotice).not.toHaveBeenCalled();
  });

  it("a vendor that THROWS (rejected runCheck) is not treated as a pass and sends no notice", async () => {
    // Hitting the catch via a rejection: the per-check catch now returns
    // could_not_screen, so the overall result holds rather than passing. The
    // vendor mock here stands in for the real catch having already mapped the
    // throw to a could_not_screen verdict. The load-bearing guarantee is that a
    // thrown/misconfigured vendor never becomes screening_passed and never fires
    // an adverse-action denial.
    mockBackground.runCheck.mockRejectedValue(
      new Error("Screening vendor unavailable — could not screen")
    );

    await service
      .runFullScreening("app-001", "user-1", "leasing_agent")
      .catch(() => undefined);

    expect(mockTransition).not.toHaveBeenCalledWith(
      expect.objectContaining({ to: "screening_passed" })
    );
    expect(mockAdverseAction.sendNotice).not.toHaveBeenCalled();
  });

  // ── review_required still sets screening_passed (routes to human review) ─

  it("transitions to screening_passed (review_required_passthrough) even when review_required (human Tier 1 will see it)", async () => {
    mockBackground.runCheck.mockResolvedValue(makeBackgroundResult("review_required"));

    await service.runFullScreening("app-001", "user-1", "leasing_agent");

    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({ to: "screening_passed", trigger: "review_required_passthrough" })
    );
  });

  it("a GENUINE review_required verdict still reaches screening_passed (borderline pass-through is UNCHANGED)", async () => {
    // Distinct from could_not_screen: this is a real borderline verdict from
    // evaluateResults(), not an infra failure. It MUST keep its existing
    // pass-through behaviour (screening_passed + Tier-2), and send no notice.
    mockBackground.runCheck.mockResolvedValue(makeBackgroundResult("review_required"));

    const result = await service.runFullScreening("app-001", "user-1", "leasing_agent");

    expect(result.overallResult).toBe("review_required");
    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({ to: "screening_passed", trigger: "review_required_passthrough" })
    );
    expect(mockTransition).not.toHaveBeenCalledWith(
      expect.objectContaining({ to: "screening_review" })
    );
    expect(mockAdverseAction.sendNotice).not.toHaveBeenCalled();
  });

  // ── PCI-DSS: SSN decryption and last-4 extraction ─────────────────────────

  it("decrypts SSN and passes only the last 4 digits to background check", async () => {
    // decrypt returns "decrypted:enc-ssn" → last4 = "n-ss" (last 4 chars of that string)
    // In real usage decrypt returns the actual SSN. We test the slice(-4) behaviour.
    mockDecrypt.mockReturnValue("123-45-6789");

    await service.runFullScreening("app-001", "user-1", "leasing_agent");

    expect(mockBackground.runCheck).toHaveBeenCalledWith(
      expect.objectContaining({ ssnLast4: "6789" })
    );
    expect(mockCredit.runCheck).toHaveBeenCalledWith(
      expect.objectContaining({ ssnLast4: "6789" })
    );
  });

  it("passes decrypted date of birth to check services", async () => {
    mockDecrypt
      .mockReturnValueOnce("123-45-6789") // SSN
      .mockReturnValueOnce("1990-06-15");  // DOB

    await service.runFullScreening("app-001", "user-1", "leasing_agent");

    expect(mockBackground.runCheck).toHaveBeenCalledWith(
      expect.objectContaining({ dateOfBirth: "1990-06-15" })
    );
  });

  it("falls back to 'NV' when current_state is not set on the application", async () => {
    mockQuery.mockReset();
    mockQuery
      .mockResolvedValueOnce({ rows: [makeApp({ current_state: null })] } as any)
      .mockResolvedValue({ rows: [] } as any);

    await service.runFullScreening("app-001", "user-1", "leasing_agent");

    expect(mockBackground.runCheck).toHaveBeenCalledWith(
      expect.objectContaining({ state: "NV" })
    );
  });

  // ── Audit logging ─────────────────────────────────────────────────────────

  it("writes screening_initiated audit log at the start", async () => {
    await service.runFullScreening("app-001", "user-1", "leasing_agent");

    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "screening_initiated", applicationId: "app-001" })
    );
  });

  it("writes audit logs for all 3 individual checks plus overall screening_completed", async () => {
    await service.runFullScreening("app-001", "user-1", "leasing_agent");

    const actions = mockAuditLog.mock.calls.map((c) => (c[0] as any).action);
    expect(actions).toContain("background_check_completed");
    expect(actions).toContain("credit_check_completed");
    expect(actions).toContain("compliance_check_completed");
    expect(actions).toContain("screening_completed");
  });

  // ── Return shape ──────────────────────────────────────────────────────────

  it("returns all three sub-results alongside overallResult", async () => {
    const result = await service.runFullScreening("app-001", "user-1", "leasing_agent");

    expect(result).toHaveProperty("overallResult");
    expect(result).toHaveProperty("background");
    expect(result).toHaveProperty("credit");
    expect(result).toHaveProperty("compliance");
  });

  // ── Compliance uses parsed annual_income ─────────────────────────────────

  it("passes parsed annualIncome to compliance check", async () => {
    mockQuery.mockReset();
    mockQuery
      .mockResolvedValueOnce({ rows: [makeApp({ annual_income: "55000" })] } as any)
      .mockResolvedValue({ rows: [] } as any);

    await service.runFullScreening("app-001", "user-1", "leasing_agent");

    expect(mockCompliance.runCheck).toHaveBeenCalledWith(
      expect.objectContaining({ annualIncome: 55000, propertyId: "prop-001" })
    );
  });

  it("defaults annualIncome to 0 when not set (zero-income LIHTC household)", async () => {
    mockQuery.mockReset();
    mockQuery
      .mockResolvedValueOnce({ rows: [makeApp({ annual_income: null })] } as any)
      .mockResolvedValue({ rows: [] } as any);

    await service.runFullScreening("app-001", "user-1", "leasing_agent");

    expect(mockCompliance.runCheck).toHaveBeenCalledWith(
      expect.objectContaining({ annualIncome: 0 })
    );
  });

  // ── householdSize forwarded from application row (Loop 28 fix) ───────────

  it("forwards household_size from application row to compliance.runCheck", async () => {
    mockQuery.mockReset();
    mockQuery
      .mockResolvedValueOnce({ rows: [makeApp({ household_size: 4 })] } as any)
      .mockResolvedValue({ rows: [] } as any);

    await service.runFullScreening("app-001", "user-1", "senior_manager");

    expect(mockCompliance.runCheck).toHaveBeenCalledWith(
      expect.objectContaining({ householdSize: 4, propertyId: "prop-001" })
    );
  });

  it("defaults householdSize to 1 when household_size is null on application row", async () => {
    mockQuery.mockReset();
    mockQuery
      .mockResolvedValueOnce({ rows: [makeApp({ household_size: null })] } as any)
      .mockResolvedValue({ rows: [] } as any);

    await service.runFullScreening("app-001", "user-1", "senior_manager");

    expect(mockCompliance.runCheck).toHaveBeenCalledWith(
      expect.objectContaining({ householdSize: 1 })
    );
  });

  // ── Identity verification (Persona / Stripe Identity) ─────────────────────

  it("verified identity passes through; overall reflects downstream checks only", async () => {
    mockIdentity.resolve.mockResolvedValue(makeIdentityResult("verified"));

    const result = await service.runFullScreening("app-001", "user-1", "leasing_agent");

    expect(result.overallResult).toBe("pass");
    expect(result.identity.result).toBe("verified");
    expect(mockBackground.runCheck).toHaveBeenCalled();
    expect(mockCredit.runCheck).toHaveBeenCalled();
    expect(mockCompliance.runCheck).toHaveBeenCalled();
    expect(mockAdverseAction.sendNotice).not.toHaveBeenCalled();
  });

  it("threads applicationId + screeningTag through to identity.resolve", async () => {
    await service.runFullScreening("app-001", "user-1", "leasing_agent", "id_verification_fail");

    expect(mockIdentity.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ applicationId: "app-001", screeningTag: "id_verification_fail" })
    );
  });

  it("identity review_required runs full pipeline; overall becomes review_required when no fails", async () => {
    mockIdentity.resolve.mockResolvedValue(makeIdentityResult("review_required"));

    const result = await service.runFullScreening("app-001", "user-1", "leasing_agent");

    expect(result.overallResult).toBe("review_required");
    expect(result.identity.result).toBe("review_required");
    expect(mockBackground.runCheck).toHaveBeenCalled();
    expect(mockCredit.runCheck).toHaveBeenCalled();
    expect(mockCompliance.runCheck).toHaveBeenCalled();
    expect(mockAdverseAction.sendNotice).not.toHaveBeenCalled();
  });

  it("identity rejected short-circuits the pipeline with FCRA adverse-action notice", async () => {
    mockIdentity.resolve.mockResolvedValue(makeIdentityResult("rejected"));

    const result = await service.runFullScreening("app-001", "user-1", "leasing_agent");

    // Mirrors the duplicate-SSN early-exit return shape.
    expect(result.overallResult).toBe("fail");
    expect(result.identity.result).toBe("rejected");
    expect(result.background.details.reason).toBe("identity_verification_rejected");
    expect(result.credit.details.reason).toBe("identity_verification_rejected");
    expect(result.compliance.details.reason).toBe("identity_verification_rejected");

    // Downstream vendor checks must NOT have run.
    expect(mockBackground.runCheck).not.toHaveBeenCalled();
    expect(mockCredit.runCheck).not.toHaveBeenCalled();
    expect(mockCompliance.runCheck).not.toHaveBeenCalled();

    // FCRA § 1681m adverse-action notice fired exactly once with screening_failed reason.
    expect(mockAdverseAction.sendNotice).toHaveBeenCalledTimes(1);
    expect(mockAdverseAction.sendNotice).toHaveBeenCalledWith(
      "app-001",
      "user-1",
      "leasing_agent",
      "screening_failed",
      expect.stringContaining("identity verification failed")
    );

    // Status flip to screening_failed via the chokepoint (mirrors dup-SSN block).
    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({ to: "screening_failed", trigger: "identity_rejected" })
    );
  });

  it("writes an identity_verification_completed audit log entry", async () => {
    await service.runFullScreening("app-001", "user-1", "leasing_agent");

    const actions = mockAuditLog.mock.calls.map((c) => (c[0] as any).action);
    expect(actions).toContain("identity_verification_completed");
  });
});

// ── getResults ────────────────────────────────────────────────────────────────

describe("ScreeningService.getResults", () => {
  let service: ScreeningService;

  beforeEach(() => {
    service = new ScreeningService();
    mockQuery.mockReset();
  });

  it("returns null when application is not found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);

    const result = await service.getResults("app-missing");

    expect(result).toBeNull();
  });

  it("returns the screening result row when found", async () => {
    const row = {
      background_check_result: "pass",
      credit_check_result: "pass",
      compliance_check_result: "pass",
      overall_screening_result: "pass",
      credit_score: 720,
    };
    mockQuery.mockResolvedValueOnce({ rows: [row] } as any);

    const result = await service.getResults("app-001");

    expect(result).toEqual(row);
  });

  it("queries by applicationId", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);

    await service.getResults("app-xyz");

    expect(mockQuery).toHaveBeenCalledWith(
      expect.any(String),
      ["app-xyz"]
    );
  });
});

// ── getReviewQueue ──────────────────────────────────────────────────────────────

describe("ScreeningService.getReviewQueue", () => {
  let service: ScreeningService;

  beforeEach(() => {
    service = new ScreeningService();
    mockQuery.mockReset();
  });

  it("queries only screening_review rows, oldest-first", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);

    await service.getReviewQueue();

    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toMatch(/WHERE status = 'screening_review'/i);
    expect(sql).toMatch(/ORDER BY created_at ASC/i);
  });

  it("SELECTs the per-check *_details and *_completed_at columns (the 'why')", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);

    await service.getReviewQueue();

    const sql = mockQuery.mock.calls[0]![0] as string;
    // The whole point of the usable queue: each check's detail + timestamp.
    expect(sql).toMatch(/identity_verification_details/);
    expect(sql).toMatch(/identity_verification_completed_at/);
    expect(sql).toMatch(/background_check_details/);
    expect(sql).toMatch(/background_check_completed_at/);
    expect(sql).toMatch(/credit_check_details/);
    expect(sql).toMatch(/credit_check_completed_at/);
    expect(sql).toMatch(/compliance_check_details/);
    expect(sql).toMatch(/compliance_check_completed_at/);
  });

  it("returns rows carrying the new detail columns through verbatim", async () => {
    const row = {
      id: "app-held-1",
      first_name: "Jane",
      last_name: "Doe",
      property_id: "prop-001",
      overall_screening_result: "could_not_screen",
      background_check_result: "could_not_screen",
      background_check_details: { reason: "vendor_unavailable" },
      background_check_completed_at: new Date("2026-05-30T10:00:00Z"),
      credit_check_details: { creditScore: 700 },
      credit_check_completed_at: new Date("2026-05-30T10:01:00Z"),
      identity_verification_details: { documentValid: true },
      identity_verification_completed_at: new Date("2026-05-30T10:02:00Z"),
      compliance_check_details: { incomeWithinLimits: true },
      compliance_check_completed_at: new Date("2026-05-30T10:03:00Z"),
    };
    mockQuery.mockResolvedValueOnce({ rows: [row] } as any);

    const queue = await service.getReviewQueue();

    expect(queue).toHaveLength(1);
    expect(queue[0]).toHaveProperty("background_check_details", { reason: "vendor_unavailable" });
    expect(queue[0]).toHaveProperty("background_check_completed_at");
    expect(queue[0]).toHaveProperty("credit_check_details");
    expect(queue[0]).toHaveProperty("identity_verification_details");
    expect(queue[0]).toHaveProperty("compliance_check_details");
  });
});

// ── getAdverseActionDraft (delegator) ─────────────────────────────────────────────

describe("ScreeningService.getAdverseActionDraft", () => {
  let service: ScreeningService;
  let mockAdverseAction: jest.Mocked<InstanceType<typeof AdverseActionService>>;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ScreeningService();
    mockAdverseAction = (service as any).adverseAction;
  });

  it("delegates to AdverseActionService.generateNoticeDraft with the same args", async () => {
    await service.getAdverseActionDraft("app-001", "Criminal history within lookback window");

    expect(mockAdverseAction.generateNoticeDraft).toHaveBeenCalledWith(
      "app-001",
      "Criminal history within lookback window"
    );
    // It must NOT commit/send: the draft path never touches sendNotice.
    expect(mockAdverseAction.sendNotice).not.toHaveBeenCalled();
  });

  it("returns the rendered draft (non-empty noticeText) from the delegate", async () => {
    const draft = await service.getAdverseActionDraft("app-001");

    expect(draft.noticeText).toBeTruthy();
    expect(typeof draft.noticeText).toBe("string");
    expect(draft.applicationId).toBe("app-001");
  });
});

// ── resolveReview (manual override of a held screening_review application) ─────────
//
// Locks the "preview === sent" invariant: the FCRA notice fired on a manual
// denial must carry the RAW reviewer notes — the exact reasonDetail the staffer
// previewed via getAdverseActionDraft(id, notes). A prefix/mutation here would
// silently make the applicant's letter diverge from what was reviewed.

describe("ScreeningService.resolveReview", () => {
  let service: ScreeningService;
  let mockAdverseAction: jest.Mocked<InstanceType<typeof AdverseActionService>>;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ScreeningService();
    mockAdverseAction = (service as any).adverseAction;
  });

  it("fires the FCRA notice with the RAW notes as reasonDetail (no prefix) on a denial", async () => {
    mockTransition.mockResolvedValue({ changed: true, status: "screening_failed" } as any);

    const notes = "Identity documents could not be verified by the vendor.";
    await service.resolveReview("app-001", "fail", notes, "user-sm-001", "senior_manager");

    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({ to: "screening_failed", trigger: "manual_override_fail" })
    );
    expect(mockAdverseAction.sendNotice).toHaveBeenCalledTimes(1);
    expect(mockAdverseAction.sendNotice).toHaveBeenCalledWith(
      "app-001",
      "user-sm-001",
      "senior_manager",
      "screening_failed",
      notes // byte-identical to the previewed draft — must NOT be prefixed/mutated
    );
  });

  it("does NOT fire an adverse-action notice on a manual pass", async () => {
    mockTransition.mockResolvedValue({ changed: true, status: "screening_passed" } as any);

    await service.resolveReview("app-001", "pass", "Vendor recovered; verdict clear.", "user-sm-001", "senior_manager");

    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({ to: "screening_passed", trigger: "manual_override_pass" })
    );
    expect(mockAdverseAction.sendNotice).not.toHaveBeenCalled();
  });

  it("does NOT send when the CAS transition is lost (changed=false) — exactly-once guard", async () => {
    mockTransition.mockResolvedValue({ changed: false, status: "screening_review" } as any);

    await service.resolveReview("app-001", "fail", "Denied.", "user-sm-001", "senior_manager");

    expect(mockAdverseAction.sendNotice).not.toHaveBeenCalled();
  });
});
