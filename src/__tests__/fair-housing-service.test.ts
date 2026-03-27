/**
 * Tests for src/modules/compliance/fair-housing.ts
 *
 * FairHousingService.generateReport() is tested against a mocked database.
 * The service produces:
 *   - Application decision statistics (outcome counts, no protected class data)
 *   - Adverse action notice completeness percentage (FCRA §1681m)
 *   - Objective screening criteria list (FHA §3604)
 *
 * Two DB queries are made per generateReport() call (in parallel via Promise.all):
 *   1. Decision stats query (applications table aggregate)
 *   2. Adverse action completeness query (joins applications + adverse_action_notices)
 */

import { FairHousingService, OBJECTIVE_SCREENING_CRITERIA } from "../modules/compliance/fair-housing";

// ── Mocks ──────────────────────────────────────────────────────────────────

jest.mock("../config/database", () => ({ query: jest.fn(), transaction: jest.fn() }));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { query } from "../config/database";

const mockQuery = query as jest.MockedFunction<typeof query>;

// ── Helpers ────────────────────────────────────────────────────────────────

function makeDecisionRow(overrides: Record<string, number> = {}) {
  return {
    total: 10,
    screening_passed: 6,
    screening_failed: 2,
    screening_review: 1,
    screening_pending: 1,
    approved: 5,
    denied: 3,
    in_progress: 2,
    ...overrides,
  };
}

/**
 * fetchDecisionStats  → 1 query (aggregate on applications)
 * fetchAdverseActionCompleteness → 2 queries (denial count + notice count)
 * Total: 3 queries per generateReport() call.
 * Both fetch methods run concurrently via Promise.all, so call order is:
 *   call #1: decision stats query
 *   call #2: denial count query
 *   call #3: notice count query
 */
function mockDbFor(decisionOverrides: Record<string, number> = {}, denial = 3, withNotice = 3) {
  mockQuery
    .mockResolvedValueOnce({ rows: [makeDecisionRow(decisionOverrides)] } as any) // decision stats
    .mockResolvedValueOnce({ rows: [{ total: denial }] } as any)                  // denial count
    .mockResolvedValueOnce({ rows: [{ with_notice: withNotice }] } as any);       // notice count
}

// ── Test suite ─────────────────────────────────────────────────────────────

describe("FairHousingService.generateReport()", () => {
  let service: FairHousingService;

  beforeEach(() => {
    service = new FairHousingService();
    jest.resetAllMocks();
  });

  // ── Report shape ──────────────────────────────────────────────────────

  it("returns a report with a valid ISO generatedAt timestamp", async () => {
    mockDbFor();
    const report = await service.generateReport(null);
    expect(report.generatedAt).toBeDefined();
    expect(() => new Date(report.generatedAt)).not.toThrow();
    expect(new Date(report.generatedAt).toISOString()).toBe(report.generatedAt);
  });

  it("sets propertyId to null when not scoped", async () => {
    mockDbFor();
    const report = await service.generateReport(null);
    expect(report.propertyId).toBeNull();
  });

  it("sets propertyId when scoped to a specific property", async () => {
    mockDbFor();
    const report = await service.generateReport("prop-001");
    expect(report.propertyId).toBe("prop-001");
  });

  // ── Decision statistics ───────────────────────────────────────────────

  it("maps DB aggregate counts to decisions.totalApplications", async () => {
    mockDbFor({ total: 25 });
    const report = await service.generateReport(null);
    expect(report.decisions.totalApplications).toBe(25);
  });

  it("maps screening outcome counts correctly", async () => {
    mockDbFor({
      screening_passed: 12,
      screening_failed: 4,
      screening_review: 3,
      screening_pending: 1,
    });
    const report = await service.generateReport(null);
    expect(report.decisions.screening.passed).toBe(12);
    expect(report.decisions.screening.failed).toBe(4);
    expect(report.decisions.screening.reviewRequired).toBe(3);
    expect(report.decisions.screening.pending).toBe(1);
  });

  it("maps approval outcome counts correctly", async () => {
    mockDbFor({ approved: 8, denied: 5, in_progress: 2 });
    const report = await service.generateReport(null);
    expect(report.decisions.approvals.approved).toBe(8);
    expect(report.decisions.approvals.denied).toBe(5);
    expect(report.decisions.approvals.inProgress).toBe(2);
  });

  // ── Adverse action completeness ────────────────────────────────────────

  it("reports 100% completeness when all denials have notices", async () => {
    mockDbFor({}, 3, 3);
    const report = await service.generateReport(null);
    expect(report.adverseActionCompleteness.totalDenials).toBe(3);
    expect(report.adverseActionCompleteness.noticesOnFile).toBe(3);
    expect(report.adverseActionCompleteness.completenessPercent).toBe(100);
    expect(report.adverseActionCompleteness.missingNotices).toBe(0);
  });

  it("calculates partial completeness correctly (3 of 4 denials have notices)", async () => {
    mockDbFor({}, 4, 3);
    const report = await service.generateReport(null);
    expect(report.adverseActionCompleteness.totalDenials).toBe(4);
    expect(report.adverseActionCompleteness.noticesOnFile).toBe(3);
    expect(report.adverseActionCompleteness.completenessPercent).toBe(75);
    expect(report.adverseActionCompleteness.missingNotices).toBe(1);
  });

  it("returns 100% completeness when there are zero denials (no notices needed)", async () => {
    mockDbFor({}, 0, 0);
    const report = await service.generateReport(null);
    expect(report.adverseActionCompleteness.completenessPercent).toBe(100);
    expect(report.adverseActionCompleteness.missingNotices).toBe(0);
  });

  // ── propertyId DB parameter scoping ──────────────────────────────────

  it("passes propertyId as the only param to all three DB queries when scoped", async () => {
    mockDbFor();
    await service.generateReport("prop-abc");
    // All 3 queries receive propertyId as their only param
    expect(mockQuery.mock.calls[0]![1]).toEqual(["prop-abc"]);
    expect(mockQuery.mock.calls[1]![1]).toEqual(["prop-abc"]);
    expect(mockQuery.mock.calls[2]![1]).toEqual(["prop-abc"]);
  });

  it("passes empty params to all three DB queries when not scoped", async () => {
    mockDbFor();
    await service.generateReport(null);
    expect(mockQuery.mock.calls[0]![1]).toEqual([]);
    expect(mockQuery.mock.calls[1]![1]).toEqual([]);
    expect(mockQuery.mock.calls[2]![1]).toEqual([]);
  });

  // ── FHA compliance content ────────────────────────────────────────────

  it("includes the OBJECTIVE_SCREENING_CRITERIA list in the report", async () => {
    mockDbFor();
    const report = await service.generateReport(null);
    expect(Array.isArray(report.objectiveCriteria)).toBe(true);
    expect(report.objectiveCriteria.length).toBeGreaterThan(0);
    expect(report.objectiveCriteria).toBe(OBJECTIVE_SCREENING_CRITERIA);
  });

  it("includes a protected class notice explaining what is NOT collected", async () => {
    mockDbFor();
    const report = await service.generateReport(null);
    expect(report.protectedClassNotice).toMatch(/no protected class information/i);
    expect(report.protectedClassNotice).toMatch(/race/i);
    expect(report.protectedClassNotice).toMatch(/disability/i);
  });
});

// ── OBJECTIVE_SCREENING_CRITERIA exported constant ────────────────────────

describe("OBJECTIVE_SCREENING_CRITERIA", () => {
  it("is a non-empty readonly array", () => {
    expect(Array.isArray(OBJECTIVE_SCREENING_CRITERIA)).toBe(true);
    expect(OBJECTIVE_SCREENING_CRITERIA.length).toBeGreaterThan(0);
  });

  it("documents criminal background criteria", () => {
    const joined = OBJECTIVE_SCREENING_CRITERIA.join(" ");
    expect(joined).toMatch(/criminal/i);
    expect(joined).toMatch(/feloni/i);
  });

  it("documents income (LIHTC AMI) criteria", () => {
    const joined = OBJECTIVE_SCREENING_CRITERIA.join(" ");
    expect(joined).toMatch(/60%.*Area Median Income|Area Median Income.*60%/i);
  });

  it("documents credit criteria", () => {
    const joined = OBJECTIVE_SCREENING_CRITERIA.join(" ");
    expect(joined).toMatch(/credit/i);
    expect(joined).toMatch(/eviction/i);
  });

  it("documents household-size-specific income limits", () => {
    const joined = OBJECTIVE_SCREENING_CRITERIA.join(" ");
    expect(joined).toMatch(/household.size/i);
  });
});
