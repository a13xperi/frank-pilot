/**
 * Tests for ApprovalService.bulkReview (src/modules/approval/service.ts)
 *
 * Bulk approval is a LOOP over the verified single-app tier review. These tests
 * prove it (a) approves a clean batch, (b) captures a per-application failure
 * WITHOUT aborting the batch, and (c) surfaces a separation-of-duties violation
 * as a per-app failure rather than throwing. Nothing in the single-app safety
 * path is bypassed.
 */

import { ApprovalService } from "../modules/approval/service";

// ── Mocks (mirror approval-service.test.ts) ─────────────────────────────────────

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

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockAuditLog = writeAuditLog as jest.MockedFunction<typeof writeAuditLog>;
const mockEnforceSoD = enforceSeparationOfDuties as jest.MockedFunction<
  typeof enforceSeparationOfDuties
>;

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeApp(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
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

// Map-based query mock: getApplication SELECT returns the app by id ($1);
// every UPDATE returns empty rows. Handles the sequential bulk loop.
function setupApps(apps: Record<string, Record<string, unknown>>) {
  mockQuery.mockImplementation((sql: any, params?: any) => {
    if (/SELECT/i.test(String(sql))) {
      const id = params?.[0];
      return Promise.resolve({ rows: id && apps[id] ? [apps[id]] : [] } as any);
    }
    return Promise.resolve({ rows: [] } as any);
  });
}

const baseBulk = {
  decision: "pass" as const,
  notes: "Lease-up batch approval",
  reviewerId: "user-reviewer",
  reviewerRole: "senior_manager",
};

describe("ApprovalService.bulkReview", () => {
  let service: ApprovalService;

  beforeEach(() => {
    service = new ApprovalService();
    jest.clearAllMocks();
    mockAuditLog.mockResolvedValue(undefined);
    mockEnforceSoD.mockReturnValue(true); // default: no SoD violation
  });

  it("approves a clean batch and returns a per-application result", async () => {
    setupApps({
      "app-1": makeApp("app-1"),
      "app-2": makeApp("app-2"),
      "app-3": makeApp("app-3"),
    });

    const res = await service.bulkReview(1, {
      applicationIds: ["app-1", "app-2", "app-3"],
      ...baseBulk,
    });

    expect(res.total).toBe(3);
    expect(res.succeeded).toBe(3);
    expect(res.failed).toBe(0);
    expect(res.results).toHaveLength(3);
    expect(res.results.every((r) => r.ok)).toBe(true);
    expect(res.results[0].status).toBe("tier1_approved");
    // writes a single bulk-operation audit entry (each app also wrote its own)
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "bulk_tier1_review" })
    );
  });

  it("captures a per-application failure WITHOUT aborting the batch", async () => {
    setupApps({
      "app-ok": makeApp("app-ok"),
      "app-bad": makeApp("app-bad", { status: "draft" }), // wrong status for tier 1
      "app-ok2": makeApp("app-ok2"),
    });

    const res = await service.bulkReview(1, {
      applicationIds: ["app-ok", "app-bad", "app-ok2"],
      ...baseBulk,
    });

    expect(res.total).toBe(3);
    expect(res.succeeded).toBe(2);
    expect(res.failed).toBe(1);
    const bad = res.results.find((r) => r.applicationId === "app-bad")!;
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/not ready for Tier 1/i);
    // the apps after the failure still ran
    expect(res.results.find((r) => r.applicationId === "app-ok2")!.ok).toBe(true);
  });

  it("surfaces a separation-of-duties violation as a per-app failure, not a throw", async () => {
    setupApps({ "app-1": makeApp("app-1") });
    mockEnforceSoD.mockReturnValue(false); // reviewer == submitter

    const res = await service.bulkReview(1, {
      applicationIds: ["app-1"],
      ...baseBulk,
    });

    expect(res.failed).toBe(1);
    expect(res.results[0].ok).toBe(false);
    expect(res.results[0].error).toMatch(/separation of duties/i);
  });

  it("routes the batch to the requested tier", async () => {
    setupApps({ "app-1": makeApp("app-1", { status: "tier1_approved" }) });

    const res = await service.bulkReview(2, {
      applicationIds: ["app-1"],
      ...baseBulk,
    });

    expect(res.tier).toBe(2);
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "bulk_tier2_review" })
    );
  });
});
