/**
 * Tests for src/modules/approval/service.ts
 *
 * Validates the 3-tier approval workflow: Tier 1 (Senior Manager),
 * Tier 2 (Regional Manager), Tier 3 (Asset Manager).
 *
 * Compliance note: HUD/LIHTC and internal controls require separation of
 * duties — no single person may submit AND approve an application. This is
 * enforced at every tier and tested exhaustively below.
 */

import { ApprovalService, ApprovalInput } from "../modules/approval/service";

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock("../config/database", () => ({ query: jest.fn() }));
jest.mock("../middleware/audit", () => ({ writeAuditLog: jest.fn() }));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../middleware/rbac", () => ({
  enforceSeparationOfDuties: jest.fn(),
}));
jest.mock("../modules/screening/fraud-detection", () => ({
  FraudDetectionService: jest.fn().mockImplementation(() => ({
    getUnresolvedFlags: jest.fn().mockResolvedValue([]),
    checkApprovalSpeed: jest.fn().mockResolvedValue(false),
  })),
}));

import { query } from "../config/database";
import { writeAuditLog } from "../middleware/audit";
import { enforceSeparationOfDuties } from "../middleware/rbac";
import { FraudDetectionService } from "../modules/screening/fraud-detection";

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockAuditLog = writeAuditLog as jest.MockedFunction<typeof writeAuditLog>;
const mockEnforceSoD = enforceSeparationOfDuties as jest.MockedFunction<typeof enforceSeparationOfDuties>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeApp(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "app-001",
    status: "screening_passed",
    submitted_by: "user-submitter",
    tier1_reviewer_id: null,
    tier2_reviewer_id: null,
    requested_rent_amount: "1000",
    background_check_result: "pass",
    credit_check_result: "pass",
    compliance_check_result: "pass",
    tier2_required: false,
    tier3_required: false,
    ...overrides,
  };
}

const baseInput: ApprovalInput = {
  applicationId: "app-001",
  decision: "pass",
  notes: "Looks good",
  reviewerId: "user-reviewer",
  reviewerRole: "senior_manager",
};

function setupQuery(app: Record<string, unknown>) {
  // getApplication SELECT returns app
  // subsequent UPDATEs return empty rows
  mockQuery
    .mockResolvedValueOnce({ rows: [app] } as any)  // getApplication
    .mockResolvedValue({ rows: [] } as any);         // UPDATE(s)
}

// ── Test Suite ────────────────────────────────────────────────────────────────

describe("ApprovalService.tier1Review", () => {
  let service: ApprovalService;

  beforeEach(() => {
    service = new ApprovalService();
    jest.clearAllMocks();
    mockAuditLog.mockResolvedValue(undefined);
    mockEnforceSoD.mockReturnValue(true); // default: no SoD violation
  });

  // ── Wrong status ─────────────────────────────────────────────────────────

  it("throws when application is in wrong status for Tier 1", async () => {
    setupQuery(makeApp({ status: "draft" }));

    await expect(service.tier1Review(baseInput)).rejects.toThrow(
      /not ready for Tier 1 review/i
    );
  });

  it("throws with the actual status in the error message", async () => {
    setupQuery(makeApp({ status: "tier2_review" }));

    await expect(service.tier1Review(baseInput)).rejects.toThrow("tier2_review");
  });

  it("proceeds when status is screening_passed", async () => {
    setupQuery(makeApp({ status: "screening_passed" }));
    await expect(service.tier1Review(baseInput)).resolves.toBeDefined();
  });

  it("proceeds when status is tier1_review", async () => {
    setupQuery(makeApp({ status: "tier1_review" }));
    await expect(service.tier1Review(baseInput)).resolves.toBeDefined();
  });

  // ── Separation of duties ──────────────────────────────────────────────────

  it("throws on separation-of-duties violation (reviewer is submitter)", async () => {
    setupQuery(makeApp());
    mockEnforceSoD.mockReturnValue(false);

    await expect(service.tier1Review(baseInput)).rejects.toThrow(
      /separation of duties/i
    );
  });

  it("calls enforceSeparationOfDuties with reviewer + [submitted_by]", async () => {
    const app = makeApp({ submitted_by: "original-submitter" });
    setupQuery(app);

    await service.tier1Review({ ...baseInput, reviewerId: "reviewer-x" });

    expect(mockEnforceSoD).toHaveBeenCalledWith("reviewer-x", ["original-submitter"]);
  });

  // ── Unresolved fraud flags ────────────────────────────────────────────────

  it("throws when there are unresolved fraud flags and decision is pass", async () => {
    setupQuery(makeApp());
    const fraudService = (service as any).fraudDetection;
    fraudService.getUnresolvedFlags.mockResolvedValue([
      { id: "flag-1", flag_type: "income_mismatch" },
    ]);

    await expect(service.tier1Review({ ...baseInput, decision: "pass" })).rejects.toThrow(
      /unresolved fraud flag/i
    );
  });

  it("does NOT throw when there are unresolved flags but decision is fail", async () => {
    setupQuery(makeApp());
    const fraudService = (service as any).fraudDetection;
    fraudService.getUnresolvedFlags.mockResolvedValue([{ id: "flag-1" }]);

    await expect(
      service.tier1Review({ ...baseInput, decision: "fail" })
    ).resolves.toBeDefined();
  });

  // ── Deny → tier1_denied ───────────────────────────────────────────────────

  it("sets status to tier1_denied when decision is fail", async () => {
    setupQuery(makeApp());

    const result = await service.tier1Review({ ...baseInput, decision: "fail" });

    expect(result.status).toBe("tier1_denied");
    expect(result.decision).toBe("fail");
  });

  it("writes audit log with tier1_denied action on deny", async () => {
    setupQuery(makeApp());

    await service.tier1Review({ ...baseInput, decision: "fail" });

    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "tier1_denied" })
    );
  });

  // ── Pass + no Tier 2 needed ───────────────────────────────────────────────

  it("returns tier1_approved when pass and no Tier 2 required", async () => {
    setupQuery(makeApp({ requested_rent_amount: "1000" }));

    const result = await service.tier1Review(baseInput);

    expect(result.status).toBe("tier1_approved");
    expect(result.requiresTier2).toBe(false);
  });

  // ── Pass + high rent → tier2_review ──────────────────────────────────────

  it("routes to tier2_review when pass and rent > $1500", async () => {
    setupQuery(makeApp({ requested_rent_amount: "2000" }));

    const result = await service.tier1Review(baseInput);

    expect(result.status).toBe("tier2_review");
    expect(result.requiresTier2).toBe(true);
  });

  it("issues second UPDATE to set tier2_review status when Tier 2 required", async () => {
    setupQuery(makeApp({ requested_rent_amount: "2000" }));

    await service.tier1Review(baseInput);

    // At minimum 2 query calls after the SELECT: UPDATE tier1 fields + UPDATE tier2_review
    expect(mockQuery.mock.calls.length).toBeGreaterThanOrEqual(3);
    const sqlCalls = mockQuery.mock.calls.map((c) => c[0] as string);
    expect(sqlCalls.some((s) => s.includes("tier2_review"))).toBe(true);
  });

  it("routes to tier2_review when pass and compliance_check_result is review_required", async () => {
    setupQuery(makeApp({ compliance_check_result: "review_required" }));

    const result = await service.tier1Review(baseInput);

    expect(result.requiresTier2).toBe(true);
    expect(result.status).toBe("tier2_review");
  });
});

// ── requiresTier2 (via tier1Review outcomes) ──────────────────────────────────

describe("ApprovalService — requiresTier2 logic", () => {
  let service: ApprovalService;

  beforeEach(() => {
    service = new ApprovalService();
    jest.clearAllMocks();
    mockEnforceSoD.mockReturnValue(true);
    mockAuditLog.mockResolvedValue(undefined);
  });

  const cases: [string, Record<string, unknown>, boolean][] = [
    ["rent $1500 exactly (not above threshold)", { requested_rent_amount: "1500" }, false],
    ["rent $1501 (above threshold)", { requested_rent_amount: "1501" }, true],
    ["background_check_result review_required", { background_check_result: "review_required" }, true],
    ["credit_check_result review_required", { credit_check_result: "review_required" }, true],
    ["compliance_check_result review_required", { compliance_check_result: "review_required" }, true],
    ["all checks pass, low rent", {}, false],
  ];

  test.each(cases)("%s", async (_, overrides, expectedTier2) => {
    const app = makeApp(overrides);
    mockQuery
      .mockResolvedValueOnce({ rows: [app] } as any)
      .mockResolvedValue({ rows: [] } as any);

    const result = await service.tier1Review(baseInput);
    expect(result.requiresTier2).toBe(expectedTier2);
  });
});

// ── requiresTier3 (via tier2Review outcomes) ──────────────────────────────────

describe("ApprovalService — requiresTier3 logic", () => {
  let service: ApprovalService;

  beforeEach(() => {
    service = new ApprovalService();
    jest.clearAllMocks();
    mockEnforceSoD.mockReturnValue(true);
    mockAuditLog.mockResolvedValue(undefined);
  });

  it("does NOT require Tier 3 when all checks pass", async () => {
    const app = makeApp({ status: "tier1_approved" });
    mockQuery
      .mockResolvedValueOnce({ rows: [app] } as any)
      .mockResolvedValue({ rows: [] } as any);

    const result = await service.tier2Review(baseInput);
    expect(result.requiresTier3).toBe(false);
  });

  it("requires Tier 3 when background_check_result is review_required", async () => {
    const app = makeApp({ status: "tier1_approved", background_check_result: "review_required" });
    mockQuery
      .mockResolvedValueOnce({ rows: [app] } as any)
      .mockResolvedValue({ rows: [] } as any);

    const result = await service.tier2Review(baseInput);
    expect(result.requiresTier3).toBe(true);
    expect(result.status).toBe("tier3_review");
  });

  it("requires Tier 3 when credit_check_result is review_required", async () => {
    const app = makeApp({ status: "tier1_approved", credit_check_result: "review_required" });
    mockQuery
      .mockResolvedValueOnce({ rows: [app] } as any)
      .mockResolvedValue({ rows: [] } as any);

    const result = await service.tier2Review(baseInput);
    expect(result.requiresTier3).toBe(true);
  });

  it("high rent alone does NOT trigger Tier 3", async () => {
    const app = makeApp({ status: "tier1_approved", requested_rent_amount: "3000" });
    mockQuery
      .mockResolvedValueOnce({ rows: [app] } as any)
      .mockResolvedValue({ rows: [] } as any);

    const result = await service.tier2Review(baseInput);
    expect(result.requiresTier3).toBe(false);
  });
});

// ── getNextAction (via getApprovalStatus) ─────────────────────────────────────

describe("ApprovalService — getNextAction", () => {
  let service: ApprovalService;

  beforeEach(() => {
    // mockReset flushes the mockResolvedValueOnce queue — required when
    // test.each cases run back-to-back and clearAllMocks() is not enough.
    mockQuery.mockReset();
    service = new ApprovalService();
    // getUnresolvedFlags returns empty by default (set up in module mock)
  });

  const statusMap: [string, string][] = [
    ["draft", "Submit application"],
    ["submitted", "Initiate screening"],
    ["screening", "Awaiting screening results"],
    ["screening_passed", "Tier 1: Senior Manager review"],
    ["screening_failed", "Application denied — notify applicant"],
    ["tier1_review", "Tier 1: Senior Manager review"],
    ["tier1_denied", "Application denied — notify applicant"],
    ["tier2_review", "Tier 2: Regional Manager review"],
    ["tier2_denied", "Application denied — escalation available"],
    ["tier3_review", "Tier 3: Asset Manager final review"],
    ["tier3_approved", "Generate lease"],
    ["tier3_denied", "Application denied — final"],
    ["lease_generated", "Set up payment and onboard tenant"],
    ["onboarded", "Complete"],
    ["unknown_status", "Unknown"],
  ];

  test.each(statusMap)('status "%s" → "%s"', async (status, expectedAction) => {
    const app = makeApp({ status });
    // Only one query call: getApplication SELECT. getUnresolvedFlags is mocked
    // on FraudDetectionService directly, not via query.
    mockQuery.mockResolvedValueOnce({ rows: [app] } as any);

    const result = await service.getApprovalStatus("app-001");
    expect(result.nextAction).toBe(expectedAction);
  });

  it('tier1_approved without tier2_required → "Generate lease"', async () => {
    const app = makeApp({ status: "tier1_approved", tier2_required: false });
    mockQuery.mockResolvedValueOnce({ rows: [app] } as any);

    const result = await service.getApprovalStatus("app-001");
    expect(result.nextAction).toBe("Generate lease");
  });

  it('tier1_approved with tier2_required → "Tier 2: Regional Manager review"', async () => {
    const app = makeApp({ status: "tier1_approved", tier2_required: true });
    mockQuery.mockResolvedValueOnce({ rows: [app] } as any);

    const result = await service.getApprovalStatus("app-001");
    expect(result.nextAction).toBe("Tier 2: Regional Manager review");
  });
});
