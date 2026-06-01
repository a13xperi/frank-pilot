/**
 * Tests for the Phase 4a extended-screening fan-out in
 * src/modules/screening/service.ts — Plaid income, direct NSOPW, and the
 * conditional Work Number W-2 cross-check, all gated behind the dark flag
 * SCREENING_EXTENDED_CHECKS_ENABLED (default OFF).
 *
 * Design intent under test:
 * - Flag OFF  → the fan-out is byte-for-byte background+credit+compliance; the
 *   extended adapters never run and never persist.
 * - Flag ON + stub gate open → the three adapters return stub verdicts and the
 *   overall result reflects them (all-pass by default).
 * - Flag ON + keyless production → each adapter is fail-loud. Plaid/NSOPW HOLD
 *   as review_required (their internal catch); Work Number has NO internal catch
 *   (P1 contract) so its throw is CONTAINED at the call site as could_not_screen
 *   and the run does NOT abort. Net verdict HOLDs in screening_review.
 * - NSOPW match → overall fail (24 CFR §5.856 lifetime mandatory denial).
 * - Income mismatch (>15%) → review_required.
 *
 * Unlike screening-service.test.ts, this suite does NOT mock the three extended
 * adapters — it exercises the real stub/fail-loud paths against the wiring. The
 * four legacy checks + fraud + adverse-action + state-machine stay mocked.
 */

import { ScreeningService } from "../modules/screening/service";

// ── Mocks (mirror screening-service.test.ts; extended adapters left REAL) ─────

jest.mock("../config/database", () => ({ query: jest.fn() }));
jest.mock("../middleware/audit", () => ({ writeAuditLog: jest.fn() }));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../utils/encryption", () => ({
  decrypt: jest.fn((v: string) => `decrypted:${v}`),
}));

jest.mock("../modules/screening/background-check", () => ({
  BackgroundCheckService: jest.fn().mockImplementation(() => ({ runCheck: jest.fn() })),
}));
jest.mock("../modules/screening/credit-check", () => ({
  CreditCheckService: jest.fn().mockImplementation(() => ({ runCheck: jest.fn() })),
}));
jest.mock("../modules/screening/compliance", () => ({
  ComplianceService: jest.fn().mockImplementation(() => ({ runCheck: jest.fn() })),
}));
jest.mock("../modules/screening/identity-verification", () => ({
  IdentityVerificationService: jest.fn().mockImplementation(() => ({ resolve: jest.fn() })),
}));
// Fraud is mocked, but unlike the legacy suite we ALSO stub checkIncomeMismatch
// (the cross-check call site). Default: no mismatch.
jest.mock("../modules/screening/fraud-detection", () => ({
  FraudDetectionService: jest.fn().mockImplementation(() => ({
    checkDuplicateSSN: jest.fn().mockResolvedValue({ existingApplicationIds: [] }),
    checkAddressFraud: jest.fn().mockResolvedValue(undefined),
    checkIncomeMismatch: jest.fn().mockResolvedValue(false),
  })),
}));
jest.mock("../modules/adverse-action/service", () => ({
  AdverseActionService: jest.fn().mockImplementation(() => ({
    sendNotice: jest.fn().mockResolvedValue({ noticeId: "n-1" }),
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
    current_state: "NV",
    property_id: "prop-001",
    annual_income: "54000", // matches the Plaid stub ($54,000) → no self mismatch
    ...overrides,
  };
}

const ENV_KEYS = [
  "SCREENING_EXTENDED_CHECKS_ENABLED",
  "NODE_ENV",
  "MOCK_MODE",
  "ALLOW_STUB_SCREENING",
  "PLAID_CLIENT_ID",
  "PLAID_SECRET",
  "NSOPW_API_KEY",
  "WORK_NUMBER_API_KEY",
] as const;

describe("ScreeningService — Phase 4a extended checks (SCREENING_EXTENDED_CHECKS_ENABLED)", () => {
  let service: ScreeningService;
  let mockIdentity: any;
  let mockBackground: any;
  let mockCredit: any;
  let mockCompliance: any;
  let mockFraud: any;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    jest.clearAllMocks();
    savedEnv = {};
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    // Clean slate: no vendor keys, flag off, stub gate decided per-test via NODE_ENV.
    delete process.env.SCREENING_EXTENDED_CHECKS_ENABLED;
    delete process.env.MOCK_MODE;
    delete process.env.ALLOW_STUB_SCREENING;
    delete process.env.PLAID_CLIENT_ID;
    delete process.env.PLAID_SECRET;
    delete process.env.NSOPW_API_KEY;
    delete process.env.WORK_NUMBER_API_KEY;

    mockAuditLog.mockResolvedValue(undefined);
    mockDecrypt.mockImplementation((v: string) => `decrypted:${v}`);
    mockTransition.mockResolvedValue({ changed: true, status: "screening_passed" } as any);

    service = new ScreeningService();
    mockIdentity = (service as any).identity;
    mockBackground = (service as any).backgroundCheck;
    mockCredit = (service as any).creditCheck;
    mockCompliance = (service as any).compliance;
    mockFraud = (service as any).fraud;

    mockIdentity.resolve.mockResolvedValue({
      result: "verified",
      confidence: 0.95,
      idType: "driver_license",
      livenessScore: 0.97,
      details: { documentValid: true, selfieMatch: true, riskSignals: [] },
    });
    mockBackground.runCheck.mockResolvedValue({
      result: "pass",
      details: { felonies: 0, sexOffenses: false, violentCrimes: false, misdemeanors: 0, riskScore: 10 },
    });
    mockCredit.runCheck.mockResolvedValue({
      result: "pass",
      creditScore: 700,
      details: { creditScore: 700, paymentHistory: "good", outstandingDebts: 0, collections: 0, evictions: 0, bankruptcies: 0 },
    });
    mockCompliance.runCheck.mockResolvedValue({
      result: "pass",
      details: { incomeWithinLimits: true, applicableAMILimit: 60000, householdIncome: 54000, amiPercentage: 80, assetVerification: "not_provided", regulatoryNotes: [] },
    });

    mockQuery
      .mockResolvedValueOnce({ rows: [makeApp()] } as any) // SELECT application
      .mockResolvedValue({ rows: [] } as any);              // every UPDATE
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  function setApp(overrides: Record<string, unknown> = {}) {
    mockQuery.mockReset();
    mockQuery
      .mockResolvedValueOnce({ rows: [makeApp(overrides)] } as any)
      .mockResolvedValue({ rows: [] } as any);
  }

  // ── Flag OFF: behaviour-neutral ───────────────────────────────────────────

  it("flag OFF → overall pass and the extended-columns UPDATE never runs", async () => {
    // flag unset by default
    const result = await service.runFullScreening("app-001", "u1", "leasing_agent");

    expect(result.overallResult).toBe("pass");
    const touchedExtended = mockQuery.mock.calls.some(
      ([sql]) => typeof sql === "string" && /income_verification_result\s*=\s*\$2/.test(sql)
    );
    expect(touchedExtended).toBe(false);
  });

  // ── Flag ON + stub gate open (jest NODE_ENV=test): adapters return stubs ───

  it("flag ON + stubs → overall pass (income+nsopw stubs both pass, no employer → WN skipped)", async () => {
    process.env.SCREENING_EXTENDED_CHECKS_ENABLED = "true";

    const result = await service.runFullScreening("app-001", "u1", "leasing_agent");

    expect(result.overallResult).toBe("pass");
    // The extended-columns UPDATE fired.
    const touchedExtended = mockQuery.mock.calls.some(
      ([sql]) => typeof sql === "string" && /income_verification_result\s*=\s*\$2/.test(sql)
    );
    expect(touchedExtended).toBe(true);
    // Cross-check ran against the self-reported figure (no employer → no WN figure).
    expect(mockFraud.checkIncomeMismatch).toHaveBeenCalled();
  });

  it("flag ON + NSOPW match (MOCK_MODE tag) → overall fail (§5.856 mandatory denial)", async () => {
    process.env.SCREENING_EXTENDED_CHECKS_ENABLED = "true";
    process.env.MOCK_MODE = "1";

    const result = await service.runFullScreening(
      "app-001",
      "u1",
      "leasing_agent",
      "deny_sex_offender"
    );

    expect(result.overallResult).toBe("fail");
    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({ to: "screening_failed", trigger: "any_check_failed" })
    );
  });

  it("flag ON + income mismatch (>15%) → overall review_required", async () => {
    process.env.SCREENING_EXTENDED_CHECKS_ENABLED = "true";
    mockFraud.checkIncomeMismatch.mockResolvedValue(true);

    const result = await service.runFullScreening("app-001", "u1", "leasing_agent");

    expect(result.overallResult).toBe("review_required");
    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({ to: "screening_passed", trigger: "review_required_passthrough" })
    );
  });

  // ── Flag ON + keyless PRODUCTION: fail-loud HOLD, Work Number throw contained ─

  it("flag ON + keyless production + declared employer → HOLDS could_not_screen and the run does NOT abort", async () => {
    process.env.SCREENING_EXTENDED_CHECKS_ENABLED = "true";
    process.env.NODE_ENV = "production"; // close the stub gate
    setApp({ employer_name: "Acme Corp" }); // forces Work Number to run (and throw)
    mockTransition.mockResolvedValue({ changed: true, status: "screening_review" } as any);

    // Must RESOLVE (no throw) — the Work Number throw is contained at the call site.
    const result = await service.runFullScreening("app-001", "u1", "leasing_agent");

    expect(result.overallResult).toBe("could_not_screen");
    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({ to: "screening_review", trigger: "could_not_screen" })
    );
    // A HOLD is never a pass.
    expect(mockTransition).not.toHaveBeenCalledWith(
      expect.objectContaining({ to: "screening_passed" })
    );
  });

  // ── Demo runtime config: MOCK_MODE on, gate OPEN, tag drives the throw ────────
  // This is the actual config behind the "one applicant lands in the Review tab"
  // demo claim (vs the keyless case above which proves the prod failure mode).

  it("flag ON + MOCK_MODE + declared employer + wn_vendor_outage tag → could_not_screen → screening_review (demo loop)", async () => {
    process.env.SCREENING_EXTENDED_CHECKS_ENABLED = "true";
    process.env.MOCK_MODE = "1"; // gate stays OPEN; the tag path runs before requireGate
    setApp({ employer_name: "Acme Corp" }); // forces Work Number to run
    mockTransition.mockResolvedValue({ changed: true, status: "screening_review" } as any);

    // Must RESOLVE — the synthetic outage throw is contained at the call site.
    const result = await service.runFullScreening(
      "app-001",
      "u1",
      "leasing_agent",
      "wn_vendor_outage"
    );

    expect(result.overallResult).toBe("could_not_screen");
    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({ to: "screening_review", trigger: "could_not_screen" })
    );
    expect(mockTransition).not.toHaveBeenCalledWith(
      expect.objectContaining({ to: "screening_passed" })
    );
  });

  it("flag ON + keyless production + NO declared employer → Plaid/NSOPW HOLD as review_required (no could_not_screen)", async () => {
    process.env.SCREENING_EXTENDED_CHECKS_ENABLED = "true";
    process.env.NODE_ENV = "production";
    // no employer_name → Work Number skipped → no could_not_screen contributor

    const result = await service.runFullScreening("app-001", "u1", "leasing_agent");

    // Plaid + NSOPW both fall to review_required via their internal catch.
    expect(result.overallResult).toBe("review_required");
    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({ to: "screening_passed", trigger: "review_required_passthrough" })
    );
  });
});
