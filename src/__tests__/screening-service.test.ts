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

import { query } from "../config/database";
import { writeAuditLog } from "../middleware/audit";
import { decrypt } from "../utils/encryption";
import { BackgroundCheckService } from "../modules/screening/background-check";
import { CreditCheckService } from "../modules/screening/credit-check";
import { ComplianceService } from "../modules/screening/compliance";

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockAuditLog = writeAuditLog as jest.MockedFunction<typeof writeAuditLog>;
const mockDecrypt = decrypt as jest.MockedFunction<typeof decrypt>;

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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ScreeningService.runFullScreening", () => {
  let service: ScreeningService;
  let mockBackground: jest.Mocked<InstanceType<typeof BackgroundCheckService>>;
  let mockCredit: jest.Mocked<InstanceType<typeof CreditCheckService>>;
  let mockCompliance: jest.Mocked<InstanceType<typeof ComplianceService>>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuditLog.mockResolvedValue(undefined);
    mockDecrypt.mockImplementation((v: string) => `decrypted:${v}`);

    service = new ScreeningService();

    // Grab the instances created inside the constructor
    mockBackground = (service as any).backgroundCheck;
    mockCredit = (service as any).creditCheck;
    mockCompliance = (service as any).compliance;

    // Default: all checks pass
    mockBackground.runCheck.mockResolvedValue(makeBackgroundResult("pass"));
    mockCredit.runCheck.mockResolvedValue(makeCreditResult("pass"));
    mockCompliance.runCheck.mockResolvedValue(makeComplianceResult("pass"));

    // Default query: app found + subsequent UPDATEs succeed
    mockQuery
      .mockResolvedValueOnce({ rows: [makeApp()] } as any) // SELECT application
      .mockResolvedValue({ rows: [] } as any);              // UPDATEs
  });

  // ── Guard: application not found / wrong status ───────────────────────────

  it("throws when application is not found or not in submitted status", async () => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);

    await expect(
      service.runFullScreening("app-missing", "user-1", "leasing_agent")
    ).rejects.toThrow(/not found or not in submitted status/i);
  });

  // ── All-pass scenario ─────────────────────────────────────────────────────

  it("returns overallResult=pass when all three checks pass", async () => {
    const result = await service.runFullScreening("app-001", "user-1", "leasing_agent");

    expect(result.overallResult).toBe("pass");
  });

  it("sets status to screening_passed when overallResult is pass", async () => {
    await service.runFullScreening("app-001", "user-1", "leasing_agent");

    const statusUpdate = mockQuery.mock.calls.find(
      (c) => (c[0] as string).includes("overall_screening_result")
    );
    expect(statusUpdate?.[1]).toContain("screening_passed");
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

  it("sets status to screening_failed when overallResult is fail", async () => {
    mockBackground.runCheck.mockResolvedValue(makeBackgroundResult("fail"));

    await service.runFullScreening("app-001", "user-1", "leasing_agent");

    const statusUpdate = mockQuery.mock.calls.find(
      (c) => (c[0] as string).includes("overall_screening_result")
    );
    expect(statusUpdate?.[1]).toContain("screening_failed");
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

  it("sets status to screening_passed even when review_required (human Tier 1 will see it)", async () => {
    mockBackground.runCheck.mockResolvedValue(makeBackgroundResult("review_required"));

    await service.runFullScreening("app-001", "user-1", "leasing_agent");

    const statusUpdate = mockQuery.mock.calls.find(
      (c) => (c[0] as string).includes("overall_screening_result")
    );
    expect(statusUpdate?.[1]).toContain("screening_passed");
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
