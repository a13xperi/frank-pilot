/**
 * Service-layer tests for src/modules/lease/service.ts
 *
 * Tests all three methods: generateLease, completeOnboarding, getLeaseStatus.
 *
 * Key dependencies mocked:
 *   - query          (../../config/database)
 *   - writeAuditLog  (../../middleware/audit)
 *   - OneSiteService (../integrations/onesite)
 *   - LoftService    (../integrations/loft)
 *   - TwilioService  (../integrations/twilio)
 *
 * State-machine facts under test:
 *   generateLease    — requires status ∈ {tier1_approved, tier2_approved, tier3_approved}
 *   completeOnboarding — requires status = 'lease_generated' AND onesite_lease_id present
 *
 * Twilio non-blocking pattern:
 *   SMS notifications use fire-and-forget (.catch()) — a Twilio failure must NOT
 *   propagate and must NOT cause the service method to throw.
 */

import { LeaseService } from "../modules/lease/service";
import { query } from "../config/database";
import { writeAuditLog } from "../middleware/audit";

// ── Mocks ──────────────────────────────────────────────────────────────────

jest.mock("../config/database", () => ({ query: jest.fn() }));
jest.mock("../middleware/audit", () => ({ writeAuditLog: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockGenerateLease = jest.fn();
const mockSyncTenant = jest.fn();

jest.mock("../modules/integrations/onesite", () => ({
  OneSiteService: jest.fn().mockImplementation(() => ({
    generateLease: mockGenerateLease,
    syncTenant: mockSyncTenant,
  })),
}));

const mockCreateTenant = jest.fn();
const mockSetupAutoPay = jest.fn();

jest.mock("../modules/integrations/loft", () => ({
  LoftService: jest.fn().mockImplementation(() => ({
    createTenant: mockCreateTenant,
    setupAutoPay: mockSetupAutoPay,
  })),
}));

const mockNotifyLeaseReady = jest.fn();
const mockNotifyApproved = jest.fn();

jest.mock("../modules/integrations/twilio", () => ({
  TwilioService: jest.fn().mockImplementation(() => ({
    notifyLeaseReady: mockNotifyLeaseReady,
    notifyApproved: mockNotifyApproved,
  })),
}));

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockWriteAuditLog = writeAuditLog as jest.MockedFunction<typeof writeAuditLog>;

// ── Helpers ────────────────────────────────────────────────────────────────

function makeService() {
  return new LeaseService();
}

/** Approved application row — ready for lease generation. */
function approvedAppRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "app-001",
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
    ...overrides,
  };
}

/** lease_generated application row — ready for onboarding. */
function leaseGeneratedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "app-001",
    status: "lease_generated",
    first_name: "Jane",
    last_name: "Doe",
    email: "jane@example.com",
    phone: "+17025550101",
    unit_number: "4B",
    requested_rent_amount: "1200.00",
    onesite_lease_id: "ols_001",
    stripe_payment_method_id: null,
    auto_pay_enrolled: false,
    ...overrides,
  };
}

// ── generateLease() ────────────────────────────────────────────────────────

describe("LeaseService.generateLease()", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockWriteAuditLog.mockReset();
    mockGenerateLease.mockReset();
    mockNotifyLeaseReady.mockReset();
  });

  it("throws when application is not found", async () => {
    mockQuery.mockResolvedValue({ rows: [] } as any);

    const service = makeService();
    await expect(
      service.generateLease("app-notexist", "user-001", "senior_manager")
    ).rejects.toThrow("Application not found");
  });

  it("throws when application is in draft status (not an approved status)", async () => {
    mockQuery.mockResolvedValue({ rows: [approvedAppRow({ status: "draft" })] } as any);

    const service = makeService();
    await expect(
      service.generateLease("app-001", "user-001", "senior_manager")
    ).rejects.toThrow(/approved status/i);
  });

  it("throws when application is in submitted status", async () => {
    mockQuery.mockResolvedValue({ rows: [approvedAppRow({ status: "submitted" })] } as any);

    const service = makeService();
    await expect(
      service.generateLease("app-001", "user-001", "senior_manager")
    ).rejects.toThrow(/approved status/i);
  });

  it("throws when application is in lease_generated status (already has lease)", async () => {
    mockQuery.mockResolvedValue({ rows: [approvedAppRow({ status: "lease_generated" })] } as any);

    const service = makeService();
    await expect(
      service.generateLease("app-001", "user-001", "senior_manager")
    ).rejects.toThrow(/approved status/i);
  });

  it("throws when requested_rent_amount is missing", async () => {
    mockQuery.mockResolvedValue({
      rows: [approvedAppRow({ requested_rent_amount: null })],
    } as any);

    const service = makeService();
    await expect(
      service.generateLease("app-001", "user-001", "senior_manager")
    ).rejects.toThrow(/missing requested rent amount/i);
  });

  it.each(["tier1_approved", "tier2_approved", "tier3_approved"])(
    "succeeds when application is in %s status",
    async (status) => {
      mockQuery.mockResolvedValue({ rows: [approvedAppRow({ status })] } as any);
      mockGenerateLease.mockResolvedValue({
        leaseId: "ols_001",
        documentUrl: "https://onesite.example.com/leases/ols_001",
      });
      mockNotifyLeaseReady.mockResolvedValue(undefined);

      const service = makeService();
      const result = await service.generateLease("app-001", "user-001", "senior_manager");

      expect(result.leaseId).toBe("ols_001");
    }
  );

  it("calls OneSiteService.generateLease with correct args", async () => {
    mockQuery.mockResolvedValue({ rows: [approvedAppRow()] } as any);
    mockGenerateLease.mockResolvedValue({ leaseId: "ols_test", documentUrl: "https://..." });
    mockNotifyLeaseReady.mockResolvedValue(undefined);

    const service = makeService();
    await service.generateLease("app-001", "user-sm-001", "senior_manager");

    expect(mockGenerateLease).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationId: "app-001",
        propertyId: "prop-001",
        unitNumber: "4B",
        tenantFirstName: "Jane",
        tenantLastName: "Doe",
        leaseTermMonths: 12,
        rentAmount: 1200,
        actorId: "user-sm-001",
        actorRole: "senior_manager",
      })
    );
  });

  it("writes lease_generated audit log with leaseId and documentUrl", async () => {
    mockQuery.mockResolvedValue({ rows: [approvedAppRow()] } as any);
    mockGenerateLease.mockResolvedValue({ leaseId: "ols_audit", documentUrl: "https://..." });
    mockNotifyLeaseReady.mockResolvedValue(undefined);

    const service = makeService();
    await service.generateLease("app-001", "user-001", "senior_manager");

    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "lease_generated",
        actorId: "user-001",
        actorRole: "senior_manager",
        applicationId: "app-001",
        details: expect.objectContaining({ leaseId: "ols_audit" }),
      })
    );
  });

  it("returns { leaseId, documentUrl } from OneSite", async () => {
    mockQuery.mockResolvedValue({ rows: [approvedAppRow()] } as any);
    mockGenerateLease.mockResolvedValue({
      leaseId: "ols_return",
      documentUrl: "https://onesite.example.com/leases/ols_return",
    });
    mockNotifyLeaseReady.mockResolvedValue(undefined);

    const service = makeService();
    const result = await service.generateLease("app-001", "user-001", "senior_manager");

    expect(result).toEqual({
      leaseId: "ols_return",
      documentUrl: "https://onesite.example.com/leases/ols_return",
    });
  });

  it("sends Twilio SMS when phone is present", async () => {
    mockQuery.mockResolvedValue({ rows: [approvedAppRow({ phone: "+17025550101" })] } as any);
    mockGenerateLease.mockResolvedValue({ leaseId: "ols_sms", documentUrl: "https://..." });
    mockNotifyLeaseReady.mockResolvedValue(undefined);

    const service = makeService();
    await service.generateLease("app-001", "user-001", "senior_manager");

    // Allow the non-blocking promise to settle
    await new Promise((r) => setTimeout(r, 0));

    expect(mockNotifyLeaseReady).toHaveBeenCalledWith("+17025550101", "Jane Doe");
  });

  it("skips Twilio SMS when phone is absent", async () => {
    mockQuery.mockResolvedValue({ rows: [approvedAppRow({ phone: null })] } as any);
    mockGenerateLease.mockResolvedValue({ leaseId: "ols_nosms", documentUrl: "https://..." });

    const service = makeService();
    await service.generateLease("app-001", "user-001", "senior_manager");

    await new Promise((r) => setTimeout(r, 0));

    expect(mockNotifyLeaseReady).not.toHaveBeenCalled();
  });

  it("does NOT throw when Twilio SMS fails (non-blocking)", async () => {
    mockQuery.mockResolvedValue({ rows: [approvedAppRow()] } as any);
    mockGenerateLease.mockResolvedValue({ leaseId: "ols_ok", documentUrl: "https://..." });
    mockNotifyLeaseReady.mockRejectedValue(new Error("Twilio down"));

    const service = makeService();
    // Should resolve without throwing despite Twilio failure
    await expect(
      service.generateLease("app-001", "user-001", "senior_manager")
    ).resolves.toMatchObject({ leaseId: "ols_ok" });

    await new Promise((r) => setTimeout(r, 0));
  });

  it("uses 'TBD' as unitNumber when unit_number is null", async () => {
    mockQuery.mockResolvedValue({ rows: [approvedAppRow({ unit_number: null })] } as any);
    mockGenerateLease.mockResolvedValue({ leaseId: "ols_tbd", documentUrl: "https://..." });
    mockNotifyLeaseReady.mockResolvedValue(undefined);

    const service = makeService();
    await service.generateLease("app-001", "user-001", "senior_manager");

    expect(mockGenerateLease).toHaveBeenCalledWith(
      expect.objectContaining({ unitNumber: "TBD" })
    );
  });
});

// ── completeOnboarding() ───────────────────────────────────────────────────

describe("LeaseService.completeOnboarding()", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockWriteAuditLog.mockReset();
    mockCreateTenant.mockReset();
    mockSetupAutoPay.mockReset();
    mockSyncTenant.mockReset();
    mockNotifyApproved.mockReset();
  });

  it("throws when application is not found", async () => {
    mockQuery.mockResolvedValue({ rows: [] } as any);

    const service = makeService();
    await expect(
      service.completeOnboarding("app-notexist", "user-001", "senior_manager")
    ).rejects.toThrow("Application not found");
  });

  it("throws when application is not in lease_generated status", async () => {
    mockQuery.mockResolvedValue({
      rows: [leaseGeneratedRow({ status: "tier1_approved" })],
    } as any);

    const service = makeService();
    await expect(
      service.completeOnboarding("app-001", "user-001", "senior_manager")
    ).rejects.toThrow(/lease_generated/i);
  });

  it("throws when onesite_lease_id is missing", async () => {
    mockQuery.mockResolvedValue({
      rows: [leaseGeneratedRow({ onesite_lease_id: null })],
    } as any);

    const service = makeService();
    await expect(
      service.completeOnboarding("app-001", "user-001", "senior_manager")
    ).rejects.toThrow(/no OneSite lease ID/i);
  });

  it("calls LoftService.createTenant with correct args", async () => {
    mockQuery.mockResolvedValue({ rows: [leaseGeneratedRow()] } as any);
    mockCreateTenant.mockResolvedValue({ loftTenantId: "lft_001" });
    mockSyncTenant.mockResolvedValue({ synced: true });
    mockNotifyApproved.mockResolvedValue(undefined);

    const service = makeService();
    await service.completeOnboarding("app-001", "user-sm-001", "senior_manager");

    expect(mockCreateTenant).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationId: "app-001",
        firstName: "Jane",
        lastName: "Doe",
        email: "jane@example.com",
        unitNumber: "4B",
        rentAmount: 1200,
        autoPayEnrolled: false,
        actorId: "user-sm-001",
        actorRole: "senior_manager",
      })
    );
  });

  it("calls LoftService.setupAutoPay when auto_pay_enrolled=true AND payment method present", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        leaseGeneratedRow({
          auto_pay_enrolled: true,
          stripe_payment_method_id: "pm_test_001",
        }),
      ],
    } as any);
    mockCreateTenant.mockResolvedValue({ loftTenantId: "lft_auto" });
    mockSetupAutoPay.mockResolvedValue({ autoPayId: "ap_001" });
    mockSyncTenant.mockResolvedValue({ synced: true });
    mockNotifyApproved.mockResolvedValue(undefined);

    const service = makeService();
    await service.completeOnboarding("app-001", "user-001", "senior_manager");

    expect(mockSetupAutoPay).toHaveBeenCalledWith(
      expect.objectContaining({
        loftTenantId: "lft_auto",
        paymentMethodToken: "pm_test_001",
        rentAmount: 1200,
        discountAmount: 25,
      })
    );
  });

  it("skips LoftService.setupAutoPay when auto_pay_enrolled=false", async () => {
    mockQuery.mockResolvedValue({
      rows: [leaseGeneratedRow({ auto_pay_enrolled: false, stripe_payment_method_id: "pm_001" })],
    } as any);
    mockCreateTenant.mockResolvedValue({ loftTenantId: "lft_no_ap" });
    mockSyncTenant.mockResolvedValue({ synced: true });
    mockNotifyApproved.mockResolvedValue(undefined);

    const service = makeService();
    await service.completeOnboarding("app-001", "user-001", "senior_manager");

    expect(mockSetupAutoPay).not.toHaveBeenCalled();
  });

  it("skips LoftService.setupAutoPay when stripe_payment_method_id is null (even if enrolled)", async () => {
    mockQuery.mockResolvedValue({
      rows: [leaseGeneratedRow({ auto_pay_enrolled: true, stripe_payment_method_id: null })],
    } as any);
    mockCreateTenant.mockResolvedValue({ loftTenantId: "lft_no_pm" });
    mockSyncTenant.mockResolvedValue({ synced: true });
    mockNotifyApproved.mockResolvedValue(undefined);

    const service = makeService();
    await service.completeOnboarding("app-001", "user-001", "senior_manager");

    expect(mockSetupAutoPay).not.toHaveBeenCalled();
  });

  it("syncs tenant to OneSite", async () => {
    mockQuery.mockResolvedValue({ rows: [leaseGeneratedRow()] } as any);
    mockCreateTenant.mockResolvedValue({ loftTenantId: "lft_sync" });
    mockSyncTenant.mockResolvedValue({ synced: true });
    mockNotifyApproved.mockResolvedValue(undefined);

    const service = makeService();
    await service.completeOnboarding("app-001", "user-001", "senior_manager");

    expect(mockSyncTenant).toHaveBeenCalledWith({
      applicationId: "app-001",
      onesiteLeaseId: "ols_001",
    });
  });

  it("updates application status to onboarded and stores loftTenantId", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [leaseGeneratedRow()] } as any) // SELECT
      .mockResolvedValueOnce({ rows: [] } as any);                   // UPDATE
    mockCreateTenant.mockResolvedValue({ loftTenantId: "lft_update" });
    mockSyncTenant.mockResolvedValue({ synced: true });
    mockNotifyApproved.mockResolvedValue(undefined);

    const service = makeService();
    await service.completeOnboarding("app-001", "user-001", "senior_manager");

    const updateCall = mockQuery.mock.calls[1];
    expect(updateCall[0]).toContain("status = 'onboarded'");
    expect(updateCall[1]).toContain("lft_update");
  });

  it("writes tenant_onboarded audit log", async () => {
    mockQuery.mockResolvedValue({ rows: [leaseGeneratedRow()] } as any);
    mockCreateTenant.mockResolvedValue({ loftTenantId: "lft_audit" });
    mockSyncTenant.mockResolvedValue({ synced: true });
    mockNotifyApproved.mockResolvedValue(undefined);

    const service = makeService();
    await service.completeOnboarding("app-001", "user-audit", "asset_manager");

    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "tenant_onboarded",
        actorId: "user-audit",
        actorRole: "asset_manager",
        applicationId: "app-001",
        details: expect.objectContaining({
          loftTenantId: "lft_audit",
          onesiteLeaseId: "ols_001",
        }),
      })
    );
  });

  it("returns { onboarded: true, loftTenantId } on success", async () => {
    mockQuery.mockResolvedValue({ rows: [leaseGeneratedRow()] } as any);
    mockCreateTenant.mockResolvedValue({ loftTenantId: "lft_return" });
    mockSyncTenant.mockResolvedValue({ synced: true });
    mockNotifyApproved.mockResolvedValue(undefined);

    const service = makeService();
    const result = await service.completeOnboarding("app-001", "user-001", "senior_manager");

    expect(result).toEqual({ onboarded: true, loftTenantId: "lft_return" });
  });

  it("does NOT throw when Twilio approval notification fails (non-blocking)", async () => {
    mockQuery.mockResolvedValue({ rows: [leaseGeneratedRow()] } as any);
    mockCreateTenant.mockResolvedValue({ loftTenantId: "lft_twilio" });
    mockSyncTenant.mockResolvedValue({ synced: true });
    mockNotifyApproved.mockRejectedValue(new Error("Twilio outage"));

    const service = makeService();
    await expect(
      service.completeOnboarding("app-001", "user-001", "senior_manager")
    ).resolves.toMatchObject({ onboarded: true });

    await new Promise((r) => setTimeout(r, 0));
  });

  it("skips Twilio notification when phone is absent", async () => {
    mockQuery.mockResolvedValue({ rows: [leaseGeneratedRow({ phone: null })] } as any);
    mockCreateTenant.mockResolvedValue({ loftTenantId: "lft_nophone" });
    mockSyncTenant.mockResolvedValue({ synced: true });

    const service = makeService();
    await service.completeOnboarding("app-001", "user-001", "senior_manager");

    await new Promise((r) => setTimeout(r, 0));

    expect(mockNotifyApproved).not.toHaveBeenCalled();
  });
});

// ── getLeaseStatus() ───────────────────────────────────────────────────────

describe("LeaseService.getLeaseStatus()", () => {
  beforeEach(() => mockQuery.mockReset());

  it("returns null when application is not found", async () => {
    mockQuery.mockResolvedValue({ rows: [] } as any);

    const service = makeService();
    const result = await service.getLeaseStatus("app-notexist");

    expect(result).toBeNull();
  });

  it("returns lease status object with correct fields when found", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          id: "app-001",
          status: "onboarded",
          onesite_lease_id: "ols_001",
          loft_tenant_id: "lft_001",
          auto_pay_enrolled: true,
        },
      ],
    } as any);

    const service = makeService();
    const result = await service.getLeaseStatus("app-001");

    expect(result).toEqual({
      applicationId: "app-001",
      status: "onboarded",
      onesiteLeaseId: "ols_001",
      loftTenantId: "lft_001",
      autoPayEnrolled: true,
    });
  });

  it("returns null for onesiteLeaseId and loftTenantId when not yet set", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          id: "app-001",
          status: "lease_generated",
          onesite_lease_id: null,
          loft_tenant_id: null,
          auto_pay_enrolled: false,
        },
      ],
    } as any);

    const service = makeService();
    const result = await service.getLeaseStatus("app-001");

    expect(result!.onesiteLeaseId).toBeNull();
    expect(result!.loftTenantId).toBeNull();
    expect(result!.autoPayEnrolled).toBe(false);
  });

  it("queries by applicationId", async () => {
    mockQuery.mockResolvedValue({ rows: [] } as any);

    const service = makeService();
    await service.getLeaseStatus("app-xyz");

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("WHERE id = $1"),
      ["app-xyz"]
    );
  });
});
