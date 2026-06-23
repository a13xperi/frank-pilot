/**
 * Tests for LeaseService.bulkGenerate + listReadyForLease (src/modules/lease/service.ts)
 *
 * Bulk lease-gen is a LOOP over the verified single-app generateLease. These tests
 * prove it (a) generates a clean batch, (b) keeps the LIHTC §42 income gate AND the
 * approved-status gate intact per application, (c) is idempotent (already-generated
 * apps are skipped, never double-generated), and (d) a per-app failure does not
 * abort the batch.
 */

import { LeaseService } from "../modules/lease/service";

// ── Mocks (mirror lease-service.test.ts) ────────────────────────────────────────

jest.mock("../config/database", () => ({ query: jest.fn() }));
jest.mock("../middleware/audit", () => ({ writeAuditLog: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../modules/tape/v2-stamp", () => ({
  stampV2LeaseExecuted: jest.fn().mockResolvedValue(undefined),
}));

const mockGenerateLease = jest.fn();
jest.mock("../modules/integrations/onesite", () => ({
  OneSiteService: jest.fn().mockImplementation(() => ({
    generateLease: mockGenerateLease,
    syncTenant: jest.fn(),
  })),
}));
jest.mock("../modules/integrations/loft", () => ({
  LoftService: jest.fn().mockImplementation(() => ({ createTenant: jest.fn(), setupAutoPay: jest.fn() })),
}));
const mockNotifyLeaseReady = jest.fn();
jest.mock("../modules/integrations/twilio", () => ({
  TwilioService: jest.fn().mockImplementation(() => ({
    notifyLeaseReady: mockNotifyLeaseReady,
    notifyApproved: jest.fn(),
  })),
}));

import { query } from "../config/database";
import { writeAuditLog } from "../middleware/audit";

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockAuditLog = writeAuditLog as jest.MockedFunction<typeof writeAuditLog>;

// ── Helpers ─────────────────────────────────────────────────────────────────

function approvedAppRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    status: "tier1_approved",
    property_id: "prop-001",
    unit_number: "4B",
    first_name: "Jane",
    last_name: "Doe",
    email: "jane@example.com",
    phone: "+17025550101",
    requested_lease_term_months: 12,
    requested_rent_amount: "1200.00",
    requested_move_in_date: new Date("2026-05-01"),
    income_verified: true,
    ...overrides,
  };
}

// getApplication SELECT returns the app by id ($1); generateLease's status UPDATE
// lives inside the mocked OneSiteService, so query is only the SELECT here.
function setupApps(apps: Record<string, Record<string, unknown>>) {
  mockQuery.mockImplementation((sql: any, params?: any) => {
    if (/SELECT/i.test(String(sql))) {
      const id = params?.[0];
      return Promise.resolve({ rows: id && apps[id] ? [apps[id]] : [] } as any);
    }
    return Promise.resolve({ rows: [] } as any);
  });
}

describe("LeaseService.bulkGenerate", () => {
  let service: LeaseService;

  beforeEach(() => {
    service = new LeaseService();
    jest.clearAllMocks();
    mockAuditLog.mockResolvedValue(undefined);
    mockGenerateLease.mockResolvedValue({ leaseId: "ols_x", documentUrl: "https://onesite/x" });
    mockNotifyLeaseReady.mockResolvedValue(undefined);
  });

  it("generates a clean batch and returns a per-application result", async () => {
    setupApps({
      "app-1": approvedAppRow("app-1"),
      "app-2": approvedAppRow("app-2", { status: "tier2_approved" }),
    });

    const res = await service.bulkGenerate(["app-1", "app-2"], "user-1", "senior_manager");

    expect(res.total).toBe(2);
    expect(res.succeeded).toBe(2);
    expect(res.failed).toBe(0);
    expect(res.results.every((r) => r.ok && r.leaseId)).toBe(true);
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "bulk_lease_generated" })
    );
  });

  it("keeps the LIHTC §42 income gate intact under bulk (unverified app fails, batch continues)", async () => {
    setupApps({
      "app-ok": approvedAppRow("app-ok"),
      "app-noincome": approvedAppRow("app-noincome", { income_verified: false }),
      "app-ok2": approvedAppRow("app-ok2"),
    });

    const res = await service.bulkGenerate(
      ["app-ok", "app-noincome", "app-ok2"],
      "user-1",
      "senior_manager"
    );

    expect(res.succeeded).toBe(2);
    expect(res.failed).toBe(1);
    const bad = res.results.find((r) => r.applicationId === "app-noincome")!;
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/income verification required/i);
    expect(res.results.find((r) => r.applicationId === "app-ok2")!.ok).toBe(true);
  });

  it("is idempotent: an already-generated application is skipped, not double-generated", async () => {
    setupApps({
      "app-done": approvedAppRow("app-done", { status: "lease_generated" }),
      "app-new": approvedAppRow("app-new"),
    });

    const res = await service.bulkGenerate(["app-done", "app-new"], "user-1", "senior_manager");

    expect(res.results.find((r) => r.applicationId === "app-done")!.ok).toBe(false);
    expect(res.results.find((r) => r.applicationId === "app-done")!.error).toMatch(/approved status/i);
    expect(res.results.find((r) => r.applicationId === "app-new")!.ok).toBe(true);
    // OneSite generateLease only called for the not-yet-generated app
    expect(mockGenerateLease).toHaveBeenCalledTimes(1);
  });
});

describe("LeaseService.listReadyForLease", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns approved + income-verified applications, mapped", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        approvedAppRow("app-1"),
        approvedAppRow("app-2", { status: "tier3_approved", first_name: "Sam", last_name: "Lee" }),
      ],
    } as any);

    const service = new LeaseService();
    const ready = await service.listReadyForLease();

    expect(ready).toHaveLength(2);
    expect(ready[0]).toMatchObject({ applicationId: "app-1", tenantName: "Jane Doe" });
    expect(ready[1]).toMatchObject({ applicationId: "app-2", tenantName: "Sam Lee" });
  });
});
