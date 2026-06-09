/**
 * Tests for the FCRA pre-adverse-action window flag gate in
 * src/modules/screening/service.ts (automated runFullScreening fail path and
 * manual resolveReview fail path).
 *
 * Flag default OFF ⇒ behaviour is byte-identical to today: a fail goes straight
 * to screening_failed + the § 1681m final notice (sendNotice). Flag ON ⇒ a fail
 * instead routes to pending_adverse_action, opens an N-business-day window
 * (adverse_action_eligible_at), and sends the intent-to-deny notice
 * (sendPreAdverseNotice). Every send stays gated on the CAS winning.
 *
 * Legal framing: best-practice / state-law-ready, NOT a federal rental mandate.
 *
 * NOTE: preAdverseConfig() reads process.env at call time, so each test sets the
 * flag immediately before invoking the method and afterEach restores the
 * original env (env persists across files under jest --runInBand).
 */

import { ScreeningService } from "../modules/screening/service";

// ── Mocks (mirror screening-service.test.ts) ────────────────────────────────

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
  IdentityVerificationService: jest.fn().mockImplementation(() => ({
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
      noticeId: "notice-001", applicationId: "app-001", sentAt: new Date(), reason: "screening_failed",
    }),
    sendPreAdverseNotice: jest.fn().mockResolvedValue({
      noticeId: "pre-001", applicationId: "app-001", sentAt: new Date(), reason: "screening_failed",
    }),
    generateNoticeDraft: jest.fn().mockResolvedValue({
      applicationId: "app-001", applicantName: "Jane Doe", propertyName: "X", noticeText: "DRAFT",
    }),
  })),
}));
jest.mock("../modules/screening/state-machine", () => ({
  transitionApplicationStatus: jest.fn(),
}));

import { query } from "../config/database";
import { transitionApplicationStatus } from "../modules/screening/state-machine";

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockTransition = transitionApplicationStatus as jest.MockedFunction<
  typeof transitionApplicationStatus
>;

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeApp(overrides: Record<string, unknown> = {}) {
  return {
    id: "app-001", status: "submitted", first_name: "Jane", last_name: "Doe",
    ssn_encrypted: "enc-ssn", date_of_birth_encrypted: "enc-dob",
    current_state: "NV", property_id: "prop-001", annual_income: "40000",
    ...overrides,
  };
}
const result = (r: string, extra: Record<string, unknown> = {}) => ({
  result: r,
  details: { felonies: 0, sexOffenses: false, violentCrimes: false, misdemeanors: 0, riskScore: 10, ...extra },
}) as any;
const credit = (r: string) => ({
  result: r, creditScore: 700,
  details: { creditScore: 700, paymentHistory: "good", outstandingDebts: 0, collections: 0, evictions: 0, bankruptcies: 0 },
}) as any;
const compliance = (r: string) => ({
  result: r,
  details: { incomeWithinLimits: r === "pass", applicableAMILimit: 50000, householdIncome: 40000, amiPercentage: 80, assetVerification: "not_provided", regulatoryNotes: [] },
}) as any;
const identity = () => ({
  result: "verified", confidence: 0.95, idType: "driver_license", livenessScore: 0.97,
  details: { documentValid: true, selfieMatch: true, riskSignals: [] },
}) as any;

function eligibleAtUpdates() {
  return mockQuery.mock.calls.filter(
    ([sql]) => typeof sql === "string" && /SET adverse_action_eligible_at = \$2/.test(sql)
  );
}

// ── Env restore (jest --runInBand persists env across files) ─────────────────

const ORIGINAL_ENABLED = process.env.FCRA_PRE_ADVERSE_ENABLED;
const ORIGINAL_WINDOW = process.env.FCRA_PRE_ADVERSE_WINDOW_DAYS;

afterEach(() => {
  if (ORIGINAL_ENABLED === undefined) delete process.env.FCRA_PRE_ADVERSE_ENABLED;
  else process.env.FCRA_PRE_ADVERSE_ENABLED = ORIGINAL_ENABLED;
  if (ORIGINAL_WINDOW === undefined) delete process.env.FCRA_PRE_ADVERSE_WINDOW_DAYS;
  else process.env.FCRA_PRE_ADVERSE_WINDOW_DAYS = ORIGINAL_WINDOW;
});

// ── Automated path (runFullScreening) ────────────────────────────────────────

describe("runFullScreening — pre-adverse flag gate (automated fail path)", () => {
  let service: ScreeningService;
  let bg: any, cr: any, co: any, id: any, aa: any;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.FCRA_PRE_ADVERSE_ENABLED;
    delete process.env.FCRA_PRE_ADVERSE_WINDOW_DAYS;
    (require("../middleware/audit").writeAuditLog as jest.Mock).mockResolvedValue(undefined);

    service = new ScreeningService();
    bg = (service as any).backgroundCheck;
    cr = (service as any).creditCheck;
    co = (service as any).compliance;
    id = (service as any).identity;
    aa = (service as any).adverseAction;

    id.resolve.mockResolvedValue(identity());
    bg.runCheck.mockResolvedValue(result("pass"));
    cr.runCheck.mockResolvedValue(credit("pass"));
    co.runCheck.mockResolvedValue(compliance("pass"));

    mockQuery.mockResolvedValueOnce({ rows: [makeApp()] } as any).mockResolvedValue({ rows: [] } as any);
    mockTransition.mockResolvedValue({ changed: true, status: "screening_passed" } as any);
  });

  it("flag OFF: a fail goes straight to screening_failed + final notice (byte-identical to today)", async () => {
    bg.runCheck.mockResolvedValue(result("fail"));
    mockTransition.mockResolvedValue({ changed: true, status: "screening_failed" } as any);

    await service.runFullScreening("app-001", "user-1", "leasing_agent");

    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({ to: "screening_failed", trigger: "any_check_failed" })
    );
    expect(aa.sendNotice).toHaveBeenCalledTimes(1);
    expect(aa.sendPreAdverseNotice).not.toHaveBeenCalled();
    expect(eligibleAtUpdates()).toHaveLength(0);
  });

  it("flag ON: a fail routes to pending_adverse_action, opens the window, sends the pre-adverse notice", async () => {
    process.env.FCRA_PRE_ADVERSE_ENABLED = "true";
    bg.runCheck.mockResolvedValue(result("fail"));
    mockTransition.mockResolvedValue({ changed: true, status: "pending_adverse_action" } as any);

    await service.runFullScreening("app-001", "user-1", "leasing_agent");

    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({ to: "pending_adverse_action", trigger: "pre_adverse_action_started" })
    );
    // window opened
    expect(eligibleAtUpdates()).toHaveLength(1);
    // pre-adverse notice sent with default 5-day window + the automated reasonDetail
    expect(aa.sendPreAdverseNotice).toHaveBeenCalledTimes(1);
    const call = aa.sendPreAdverseNotice.mock.calls[0];
    expect(call[0]).toBe("app-001");
    expect(call[1]).toBe("user-1");
    expect(call[3]).toBe("screening_failed");
    expect(call[4]).toBe(5); // default windowDays
    expect(call[5]).toBeInstanceOf(Date); // eligibleAt
    expect(call[6]).toMatch(/Automated screening denial/);
    // the final § 1681m notice is NOT sent up front
    expect(aa.sendNotice).not.toHaveBeenCalled();
  });

  it("flag ON: honours a custom FCRA_PRE_ADVERSE_WINDOW_DAYS", async () => {
    process.env.FCRA_PRE_ADVERSE_ENABLED = "true";
    process.env.FCRA_PRE_ADVERSE_WINDOW_DAYS = "10";
    bg.runCheck.mockResolvedValue(result("fail"));
    mockTransition.mockResolvedValue({ changed: true, status: "pending_adverse_action" } as any);

    await service.runFullScreening("app-001", "user-1", "leasing_agent");

    expect(aa.sendPreAdverseNotice.mock.calls[0][4]).toBe(10);
  });

  it("flag ON: a lost CAS (changed:false) sends NO notice and opens NO window", async () => {
    process.env.FCRA_PRE_ADVERSE_ENABLED = "true";
    bg.runCheck.mockResolvedValue(result("fail"));
    mockTransition.mockResolvedValue({ changed: false, status: "pending_adverse_action" } as any);

    await service.runFullScreening("app-001", "user-1", "leasing_agent");

    expect(aa.sendPreAdverseNotice).not.toHaveBeenCalled();
    expect(aa.sendNotice).not.toHaveBeenCalled();
    expect(eligibleAtUpdates()).toHaveLength(0);
  });

  it("flag ON: a PASS is unaffected — no pre-adverse hold, no notices", async () => {
    process.env.FCRA_PRE_ADVERSE_ENABLED = "true";
    mockTransition.mockResolvedValue({ changed: true, status: "screening_passed" } as any);

    await service.runFullScreening("app-001", "user-1", "leasing_agent");

    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({ to: "screening_passed", trigger: "all_checks_passed" })
    );
    expect(aa.sendPreAdverseNotice).not.toHaveBeenCalled();
    expect(aa.sendNotice).not.toHaveBeenCalled();
    expect(eligibleAtUpdates()).toHaveLength(0);
  });

  it("flag literally 'false' behaves as OFF", async () => {
    process.env.FCRA_PRE_ADVERSE_ENABLED = "false";
    bg.runCheck.mockResolvedValue(result("fail"));
    mockTransition.mockResolvedValue({ changed: true, status: "screening_failed" } as any);

    await service.runFullScreening("app-001", "user-1", "leasing_agent");

    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({ to: "screening_failed", trigger: "any_check_failed" })
    );
    expect(aa.sendPreAdverseNotice).not.toHaveBeenCalled();
  });
});

// ── Manual review path (resolveReview) ───────────────────────────────────────

describe("resolveReview — pre-adverse flag gate (manual fail path, preview === sent)", () => {
  let service: ScreeningService;
  let aa: any;
  const NOTES = "Identity documents could not be verified by the vendor.";

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.FCRA_PRE_ADVERSE_ENABLED;
    delete process.env.FCRA_PRE_ADVERSE_WINDOW_DAYS;
    service = new ScreeningService();
    aa = (service as any).adverseAction;
    mockQuery.mockResolvedValue({ rows: [] } as any);
  });

  it("flag OFF: a manual fail goes to screening_failed + final notice with RAW notes", async () => {
    mockTransition.mockResolvedValue({ changed: true, status: "screening_failed" } as any);

    await service.resolveReview("app-001", "fail", NOTES, "user-sm-001", "senior_manager");

    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({ to: "screening_failed", trigger: "manual_override_fail" })
    );
    expect(aa.sendNotice).toHaveBeenCalledWith("app-001", "user-sm-001", "senior_manager", "screening_failed", NOTES);
    expect(aa.sendPreAdverseNotice).not.toHaveBeenCalled();
    expect(eligibleAtUpdates()).toHaveLength(0);
  });

  it("flag ON: a manual fail routes to pending_adverse_action + pre-adverse notice with the RAW notes (preview === sent)", async () => {
    process.env.FCRA_PRE_ADVERSE_ENABLED = "true";
    mockTransition.mockResolvedValue({ changed: true, status: "pending_adverse_action" } as any);

    await service.resolveReview("app-001", "fail", NOTES, "user-sm-001", "senior_manager");

    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({ to: "pending_adverse_action", trigger: "pre_adverse_action_started" })
    );
    expect(eligibleAtUpdates()).toHaveLength(1);
    expect(aa.sendPreAdverseNotice).toHaveBeenCalledTimes(1);
    const call = aa.sendPreAdverseNotice.mock.calls[0];
    expect(call[0]).toBe("app-001");
    expect(call[1]).toBe("user-sm-001");
    expect(call[2]).toBe("senior_manager");
    expect(call[3]).toBe("screening_failed");
    expect(call[4]).toBe(5);
    expect(call[5]).toBeInstanceOf(Date);
    expect(call[6]).toBe(NOTES); // RAW notes — byte-identical to the previewed draft
    expect(aa.sendNotice).not.toHaveBeenCalled();
  });

  it("flag ON: a lost CAS sends NO notice and opens NO window", async () => {
    process.env.FCRA_PRE_ADVERSE_ENABLED = "true";
    mockTransition.mockResolvedValue({ changed: false, status: "screening_review" } as any);

    await service.resolveReview("app-001", "fail", NOTES, "user-sm-001", "senior_manager");

    expect(aa.sendPreAdverseNotice).not.toHaveBeenCalled();
    expect(aa.sendNotice).not.toHaveBeenCalled();
    expect(eligibleAtUpdates()).toHaveLength(0);
  });

  it("flag ON: a manual PASS is unaffected (no hold, no notice)", async () => {
    process.env.FCRA_PRE_ADVERSE_ENABLED = "true";
    mockTransition.mockResolvedValue({ changed: true, status: "screening_passed" } as any);

    await service.resolveReview("app-001", "pass", "Vendor recovered; verdict clear.", "user-sm-001", "senior_manager");

    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({ to: "screening_passed", trigger: "manual_override_pass" })
    );
    expect(aa.sendPreAdverseNotice).not.toHaveBeenCalled();
    expect(aa.sendNotice).not.toHaveBeenCalled();
    expect(eligibleAtUpdates()).toHaveLength(0);
  });
});
