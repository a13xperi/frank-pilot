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

function makeBackgroundResult(result: "pass" | "fail" | "review_required") {
  return {
    result,
    details: {
      felonies: 0, sexOffenses: false, violentCrimes: false,
      misdemeanors: 0, riskScore: 10,
    },
  } as any;
}

function makeCreditResult(result: "pass" | "fail" | "review_required", score = 700) {
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
    mockIdentity.verify.mockResolvedValue(makeIdentityResult("verified"));
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

  // ── review_required still sets screening_passed (routes to human review) ─

  it("transitions to screening_passed (review_required_passthrough) even when review_required (human Tier 1 will see it)", async () => {
    mockBackground.runCheck.mockResolvedValue(makeBackgroundResult("review_required"));

    await service.runFullScreening("app-001", "user-1", "leasing_agent");

    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({ to: "screening_passed", trigger: "review_required_passthrough" })
    );
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
    mockIdentity.verify.mockResolvedValue(makeIdentityResult("verified"));

    const result = await service.runFullScreening("app-001", "user-1", "leasing_agent");

    expect(result.overallResult).toBe("pass");
    expect(result.identity.result).toBe("verified");
    expect(mockBackground.runCheck).toHaveBeenCalled();
    expect(mockCredit.runCheck).toHaveBeenCalled();
    expect(mockCompliance.runCheck).toHaveBeenCalled();
    expect(mockAdverseAction.sendNotice).not.toHaveBeenCalled();
  });

  it("threads screeningTag through to identity.verify", async () => {
    await service.runFullScreening("app-001", "user-1", "leasing_agent", "id_verification_fail");

    expect(mockIdentity.verify).toHaveBeenCalledWith(
      expect.objectContaining({ screeningTag: "id_verification_fail" })
    );
  });

  it("identity review_required runs full pipeline; overall becomes review_required when no fails", async () => {
    mockIdentity.verify.mockResolvedValue(makeIdentityResult("review_required"));

    const result = await service.runFullScreening("app-001", "user-1", "leasing_agent");

    expect(result.overallResult).toBe("review_required");
    expect(result.identity.result).toBe("review_required");
    expect(mockBackground.runCheck).toHaveBeenCalled();
    expect(mockCredit.runCheck).toHaveBeenCalled();
    expect(mockCompliance.runCheck).toHaveBeenCalled();
    expect(mockAdverseAction.sendNotice).not.toHaveBeenCalled();
  });

  it("identity rejected short-circuits the pipeline with FCRA adverse-action notice", async () => {
    mockIdentity.verify.mockResolvedValue(makeIdentityResult("rejected"));

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
