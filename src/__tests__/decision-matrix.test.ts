/**
 * Tests for src/modules/decision-matrix/service.ts
 *
 * Validates lease modification routing rules, role enforcement, and
 * re-screening triggers for the 5 modification types.
 *
 * Compliance note: HUD/LIHTC §42 and internal controls require that
 * material lease changes have documented approval from the appropriate
 * management tier. Tenant substitutions always trigger full FCRA re-screening.
 */

import { DecisionMatrixService } from "../modules/decision-matrix/service";

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock("../config/database", () => ({ query: jest.fn() }));
jest.mock("../middleware/audit", () => ({ writeAuditLog: jest.fn() }));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../middleware/rbac", () => ({
  meetsMinimumRole: jest.fn(),
}));

import { query } from "../config/database";
import { writeAuditLog } from "../middleware/audit";
import { meetsMinimumRole } from "../middleware/rbac";

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockAuditLog = writeAuditLog as jest.MockedFunction<typeof writeAuditLog>;
const mockMeetsRole = meetsMinimumRole as jest.MockedFunction<typeof meetsMinimumRole>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeModRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "mod-001",
    application_id: "app-001",
    modification_type: "rent_increase",
    status: "pending",
    required_role: "regional_manager",
    ...overrides,
  };
}

const baseRequest = {
  applicationId: "app-001",
  description: "Requesting change",
  requestedBy: "user-agent",
  requestedByRole: "leasing_agent",
};

// ── requestModification ───────────────────────────────────────────────────────

describe("DecisionMatrixService.requestModification", () => {
  let service: DecisionMatrixService;

  beforeEach(() => {
    service = new DecisionMatrixService();
    jest.clearAllMocks();
    mockAuditLog.mockResolvedValue(undefined);
    mockQuery.mockResolvedValue({ rows: [makeModRow()] } as any);
  });

  // ── Unknown type ──────────────────────────────────────────────────────────

  it("throws for an unknown modification type", async () => {
    await expect(
      service.requestModification({
        ...baseRequest,
        modificationType: "unknown_type" as any,
      })
    ).rejects.toThrow(/unknown modification type/i);

    expect(mockQuery).not.toHaveBeenCalled();
  });

  // ── Modification type routing rules ──────────────────────────────────────

  it("tenant_substitution sets requiresRescreening=true in INSERT", async () => {
    await service.requestModification({
      ...baseRequest,
      modificationType: "tenant_substitution",
    });

    const insertArgs = mockQuery.mock.calls[0][1] as unknown[];
    expect(insertArgs).toContain(true); // rescreening_required
  });

  it("lease_term_change routes to asset_manager", async () => {
    await service.requestModification({
      ...baseRequest,
      modificationType: "lease_term_change",
    });

    const insertArgs = mockQuery.mock.calls[0][1] as unknown[];
    expect(insertArgs).toContain("asset_manager");
  });

  it("pet_policy_change routes to senior_manager", async () => {
    await service.requestModification({
      ...baseRequest,
      modificationType: "pet_policy_change",
    });

    const insertArgs = mockQuery.mock.calls[0][1] as unknown[];
    expect(insertArgs).toContain("senior_manager");
  });

  it("other modification type routes to senior_manager", async () => {
    await service.requestModification({
      ...baseRequest,
      modificationType: "other",
    });

    const insertArgs = mockQuery.mock.calls[0][1] as unknown[];
    expect(insertArgs).toContain("senior_manager");
  });

  // ── Rent increase threshold ───────────────────────────────────────────────

  it("rent_increase >10% routes to regional_manager", async () => {
    await service.requestModification({
      ...baseRequest,
      modificationType: "rent_increase",
      originalValue: "1000",
      requestedValue: "1200", // 20% increase
    });

    const insertArgs = mockQuery.mock.calls[0][1] as unknown[];
    expect(insertArgs).toContain("regional_manager");
  });

  it("rent_increase exactly 10% routes to senior_manager (boundary: ≤10%)", async () => {
    await service.requestModification({
      ...baseRequest,
      modificationType: "rent_increase",
      originalValue: "1000",
      requestedValue: "1100", // exactly 10%
    });

    const insertArgs = mockQuery.mock.calls[0][1] as unknown[];
    expect(insertArgs).toContain("senior_manager");
  });

  it("rent_increase >10% still routes to regional_manager after a prior ≤10% call", async () => {
    // Regression test for the former mutation bug: a ≤10% call must not affect
    // the shared MODIFICATION_RULES constant for subsequent >10% calls.
    await service.requestModification({
      ...baseRequest,
      modificationType: "rent_increase",
      originalValue: "1000",
      requestedValue: "1150", // 15% — should still be regional_manager
    });

    const insertArgs = mockQuery.mock.calls[0][1] as unknown[];
    expect(insertArgs).toContain("regional_manager");
  });

  it("rent_increase without values uses the default rule (regional_manager)", async () => {
    // No values provided → skips the >10% check → falls back to rule default.
    await service.requestModification({
      ...baseRequest,
      modificationType: "rent_increase",
    });

    const insertArgs = mockQuery.mock.calls[0][1] as unknown[];
    expect(insertArgs).toContain("regional_manager");
  });

  // ── Side effects ──────────────────────────────────────────────────────────

  it("writes audit log with lease_modification_requested action", async () => {
    await service.requestModification({
      ...baseRequest,
      modificationType: "pet_policy_change",
    });

    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "lease_modification_requested",
        actorId: "user-agent",
        applicationId: "app-001",
      })
    );
  });

  it("returns the inserted row merged with the rule description", async () => {
    const row = makeModRow({ modification_type: "pet_policy_change" });
    mockQuery.mockResolvedValueOnce({ rows: [row] } as any);

    const result = await service.requestModification({
      ...baseRequest,
      modificationType: "pet_policy_change",
    });

    expect(result.rule).toMatch(/senior manager/i);
  });

  it("tenant_substitution audit log includes requiresRescreening: true", async () => {
    await service.requestModification({
      ...baseRequest,
      modificationType: "tenant_substitution",
    });

    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({ requiresRescreening: true }),
      })
    );
  });
});

// ── decideModification ────────────────────────────────────────────────────────

describe("DecisionMatrixService.decideModification", () => {
  let service: DecisionMatrixService;

  const baseDecision = {
    modificationId: "mod-001",
    decision: "approve" as const,
    notes: "Approved after review",
    decidedBy: "mgr-1",
    decidedByRole: "regional_manager",
  };

  beforeEach(() => {
    service = new DecisionMatrixService();
    mockQuery.mockReset();
    mockAuditLog.mockResolvedValue(undefined);
    mockMeetsRole.mockReturnValue(true);
  });

  // ── Guard: already decided ────────────────────────────────────────────────

  it("throws when modification is not pending", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [makeModRow({ status: "approved" })],
    } as any);

    await expect(service.decideModification(baseDecision)).rejects.toThrow(
      /already decided/i
    );
  });

  // ── Guard: insufficient role ──────────────────────────────────────────────

  it("throws when decider does not meet the required role", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [makeModRow({ status: "pending", required_role: "asset_manager" })],
    } as any);
    mockMeetsRole.mockReturnValue(false);

    await expect(
      service.decideModification({ ...baseDecision, decidedByRole: "leasing_agent" })
    ).rejects.toThrow(/insufficient role/i);
  });

  it("calls meetsMinimumRole with the decider role and required role", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [makeModRow({ required_role: "asset_manager" })] } as any)
      .mockResolvedValueOnce({ rows: [makeModRow({ status: "approved" })] } as any);

    await service.decideModification({
      ...baseDecision,
      decidedByRole: "asset_manager",
    });

    expect(mockMeetsRole).toHaveBeenCalledWith("asset_manager", "asset_manager");
  });

  // ── Approve ───────────────────────────────────────────────────────────────

  it("updates status to approved when decision is approve", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [makeModRow()] } as any) // getModification
      .mockResolvedValueOnce({ rows: [makeModRow({ status: "approved" })] } as any); // UPDATE

    const result = await service.decideModification(baseDecision);

    expect(result.status).toBe("approved");
  });

  it("writes audit log with lease_modification_approved on approve", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [makeModRow()] } as any)
      .mockResolvedValueOnce({ rows: [makeModRow({ status: "approved" })] } as any);

    await service.decideModification(baseDecision);

    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "lease_modification_approved" })
    );
  });

  // ── Deny ──────────────────────────────────────────────────────────────────

  it("updates status to denied when decision is deny", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [makeModRow()] } as any)
      .mockResolvedValueOnce({ rows: [makeModRow({ status: "denied" })] } as any);

    const result = await service.decideModification({ ...baseDecision, decision: "deny" });

    expect(result.status).toBe("denied");
  });

  it("writes audit log with lease_modification_denied on deny", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [makeModRow()] } as any)
      .mockResolvedValueOnce({ rows: [makeModRow({ status: "denied" })] } as any);

    await service.decideModification({ ...baseDecision, decision: "deny" });

    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "lease_modification_denied" })
    );
  });
});

// ── listModifications ─────────────────────────────────────────────────────────

describe("DecisionMatrixService.listModifications", () => {
  let service: DecisionMatrixService;

  beforeEach(() => {
    service = new DecisionMatrixService();
    mockQuery.mockReset();
  });

  it("returns all modifications for an application", async () => {
    const rows = [makeModRow(), makeModRow({ id: "mod-002" })];
    mockQuery.mockResolvedValueOnce({ rows } as any);

    const result = await service.listModifications("app-001");

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("mod-001");
  });

  it("queries by application_id", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);

    await service.listModifications("app-999");

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("application_id"),
      ["app-999"]
    );
  });

  it("returns empty array when no modifications exist", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);

    const result = await service.listModifications("app-empty");

    expect(result).toEqual([]);
  });
});
