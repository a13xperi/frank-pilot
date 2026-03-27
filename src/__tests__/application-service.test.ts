/**
 * Service-layer tests for src/modules/application/service.ts
 *
 * Tests all six methods: create, submit, getById, list, update, cancel.
 *
 * Key dependencies mocked:
 *   - query / transaction  (../../config/database)
 *   - encrypt / hashSSN / maskSSN  (../../utils/encryption)
 *   - writeAuditLog  (../../middleware/audit)
 *   - FraudDetectionService  (../screening/fraud-detection)
 *
 * PCI-DSS / FCRA facts verified:
 *   - SSN is always encrypted before DB write (create)
 *   - DOB is always encrypted before DB write (create)
 *   - ssn_encrypted and date_of_birth_encrypted are stripped from getById response
 *   - ssn_masked is added to getById response (last 4 only visible)
 *   - Duplicate SSN triggers a high-severity fraud flag (create)
 */

import { ApplicationService } from "../modules/application/service";
import { query, transaction } from "../config/database";
import { encrypt, hashSSN, maskSSN } from "../utils/encryption";
import { writeAuditLog } from "../middleware/audit";

// ── Mocks ──────────────────────────────────────────────────────────────────

jest.mock("../config/database", () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));

jest.mock("../utils/encryption", () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  hashSSN: jest.fn((v: string) => `hash:${v}`),
  maskSSN: jest.fn((v: string) => `masked:${v}`),
  decrypt: jest.fn(),
}));

jest.mock("../middleware/audit", () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockCheckDuplicateSSN = jest.fn();
const mockRaiseFraudFlag = jest.fn().mockResolvedValue(undefined);
const mockCheckAddressFraud = jest.fn().mockResolvedValue(undefined);

jest.mock("../modules/screening/fraud-detection", () => ({
  FraudDetectionService: jest.fn().mockImplementation(() => ({
    checkDuplicateSSN: mockCheckDuplicateSSN,
    raiseFraudFlag: mockRaiseFraudFlag,
    checkAddressFraud: mockCheckAddressFraud,
  })),
}));

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockTransaction = transaction as jest.MockedFunction<typeof transaction>;
const mockEncrypt = encrypt as jest.MockedFunction<typeof encrypt>;
const mockHashSSN = hashSSN as jest.MockedFunction<typeof hashSSN>;
const mockMaskSSN = maskSSN as jest.MockedFunction<typeof maskSSN>;
const mockWriteAuditLog = writeAuditLog as jest.MockedFunction<typeof writeAuditLog>;

// ── Helpers ────────────────────────────────────────────────────────────────

function minimalInput() {
  return {
    propertyId: "prop-001",
    firstName: "Jane",
    lastName: "Doe",
    ssn: "123-45-6789",
    dateOfBirth: "1990-06-15",
    householdSize: 1,
    requestedLeaseTermMonths: 12,
  };
}

function makeService() {
  return new ApplicationService();
}

// ── create() ───────────────────────────────────────────────────────────────

describe("ApplicationService.create()", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockTransaction.mockReset();
    mockCheckDuplicateSSN.mockReset();
    mockRaiseFraudFlag.mockReset();
    mockCheckAddressFraud.mockReset();
    mockWriteAuditLog.mockReset();
  });

  it("encrypts SSN and DOB before writing to the database (PCI-DSS)", async () => {
    mockCheckDuplicateSSN.mockResolvedValue({ isDuplicate: false, existingApplicationIds: [] });
    mockTransaction.mockImplementation(async (fn) => fn({ query: jest.fn().mockResolvedValue({ rows: [{ id: "app-001", status: "draft", created_at: new Date() }] }) } as any));

    const service = makeService();
    await service.create(minimalInput(), "user-001", "leasing_agent");

    // SSN digits stripped before encryption
    expect(mockEncrypt).toHaveBeenCalledWith("123456789");
    expect(mockHashSSN).toHaveBeenCalledWith("123456789");
    expect(mockEncrypt).toHaveBeenCalledWith("1990-06-15");
  });

  it("passes encrypted SSN and DOB (not plaintext) to the INSERT query", async () => {
    mockCheckDuplicateSSN.mockResolvedValue({ isDuplicate: false, existingApplicationIds: [] });

    const clientQuery = jest.fn().mockResolvedValue({
      rows: [{ id: "app-001", status: "draft", created_at: new Date() }],
    });
    mockTransaction.mockImplementation(async (fn) => fn({ query: clientQuery } as any));

    const service = makeService();
    await service.create(minimalInput(), "user-001", "leasing_agent");

    const insertParams = clientQuery.mock.calls[0][1] as unknown[];
    // ssnEncrypted (index 4) should be enc:123456789, not "123-45-6789"
    expect(insertParams[4]).toBe("enc:123456789");
    // ssnHash (index 5)
    expect(insertParams[5]).toBe("hash:123456789");
    // dobEncrypted (index 6)
    expect(insertParams[6]).toBe("enc:1990-06-15");
    // plaintext SSN must NOT appear in params
    expect(insertParams).not.toContain("123-45-6789");
    expect(insertParams).not.toContain("123456789");
  });

  it("checks for duplicate SSN before insert", async () => {
    mockCheckDuplicateSSN.mockResolvedValue({ isDuplicate: false, existingApplicationIds: [] });
    mockTransaction.mockImplementation(async (fn) =>
      fn({ query: jest.fn().mockResolvedValue({ rows: [{ id: "app-001", status: "draft", created_at: new Date() }] }) } as any)
    );

    const service = makeService();
    await service.create(minimalInput(), "user-001", "leasing_agent");

    expect(mockCheckDuplicateSSN).toHaveBeenCalledWith("hash:123456789");
  });

  it("raises high-severity fraud flag when duplicate SSN is found", async () => {
    mockCheckDuplicateSSN.mockResolvedValue({
      isDuplicate: true,
      existingApplicationIds: ["app-existing-001"],
    });

    const mockClient = { query: jest.fn().mockResolvedValue({ rows: [{ id: "app-002", status: "draft", created_at: new Date() }] }) } as any;
    mockTransaction.mockImplementation(async (fn) => fn(mockClient));

    const service = makeService();
    await service.create(minimalInput(), "user-001", "leasing_agent");

    expect(mockRaiseFraudFlag).toHaveBeenCalledWith(
      mockClient,
      expect.objectContaining({
        applicationId: "app-002",
        flagType: "duplicate_ssn",
        severity: "high",
      })
    );
  });

  it("does NOT raise fraud flag when no duplicate SSN is found", async () => {
    mockCheckDuplicateSSN.mockResolvedValue({ isDuplicate: false, existingApplicationIds: [] });
    mockTransaction.mockImplementation(async (fn) =>
      fn({ query: jest.fn().mockResolvedValue({ rows: [{ id: "app-003", status: "draft", created_at: new Date() }] }) } as any)
    );

    const service = makeService();
    await service.create(minimalInput(), "user-001", "leasing_agent");

    expect(mockRaiseFraudFlag).not.toHaveBeenCalled();
  });

  it("checks address fraud when currentAddressLine1 is provided", async () => {
    mockCheckDuplicateSSN.mockResolvedValue({ isDuplicate: false, existingApplicationIds: [] });
    const mockClient = { query: jest.fn().mockResolvedValue({ rows: [{ id: "app-004", status: "draft", created_at: new Date() }] }) } as any;
    mockTransaction.mockImplementation(async (fn) => fn(mockClient));

    const service = makeService();
    await service.create(
      { ...minimalInput(), currentAddressLine1: "123 Main St", currentCity: "Reno", currentState: "NV" },
      "user-001",
      "leasing_agent"
    );

    expect(mockCheckAddressFraud).toHaveBeenCalledWith(
      mockClient,
      "app-004",
      expect.objectContaining({ addressLine1: "123 Main St" })
    );
  });

  it("skips address fraud check when currentAddressLine1 is absent", async () => {
    mockCheckDuplicateSSN.mockResolvedValue({ isDuplicate: false, existingApplicationIds: [] });
    mockTransaction.mockImplementation(async (fn) =>
      fn({ query: jest.fn().mockResolvedValue({ rows: [{ id: "app-005", status: "draft", created_at: new Date() }] }) } as any)
    );

    const service = makeService();
    await service.create(minimalInput(), "user-001", "leasing_agent"); // no address

    expect(mockCheckAddressFraud).not.toHaveBeenCalled();
  });

  it("writes application_created audit log with masked SSN", async () => {
    mockCheckDuplicateSSN.mockResolvedValue({ isDuplicate: false, existingApplicationIds: [] });
    mockTransaction.mockImplementation(async (fn) =>
      fn({ query: jest.fn().mockResolvedValue({ rows: [{ id: "app-006", status: "draft", created_at: new Date() }] }) } as any)
    );

    const service = makeService();
    await service.create(minimalInput(), "user-audit-001", "senior_manager");

    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "application_created",
        actorId: "user-audit-001",
        actorRole: "senior_manager",
        applicationId: "app-006",
        details: expect.objectContaining({
          ssn: expect.stringMatching(/masked:/),
        }),
      })
    );
  });

  it("returns the created application row from the transaction", async () => {
    mockCheckDuplicateSSN.mockResolvedValue({ isDuplicate: false, existingApplicationIds: [] });
    const createdRow = { id: "app-007", status: "draft", created_at: new Date() };
    mockTransaction.mockImplementation(async (fn) =>
      fn({ query: jest.fn().mockResolvedValue({ rows: [createdRow] }) } as any)
    );

    const service = makeService();
    const result = await service.create(minimalInput(), "user-001", "leasing_agent");

    expect(result.id).toBe("app-007");
    expect(result.status).toBe("draft");
  });
});

// ── submit() ───────────────────────────────────────────────────────────────

describe("ApplicationService.submit()", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockWriteAuditLog.mockReset();
  });

  it("updates application status from draft to submitted", async () => {
    mockQuery.mockResolvedValue({
      rows: [{ id: "app-001", status: "submitted", submitted_at: new Date() }],
    } as any);

    const service = makeService();
    const result = await service.submit("app-001", "user-001", "leasing_agent");

    expect(result.status).toBe("submitted");
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("status = 'submitted'"),
      ["app-001", "user-001"]
    );
  });

  it("throws when application is not found or not in draft status", async () => {
    mockQuery.mockResolvedValue({ rows: [] } as any);

    const service = makeService();
    await expect(
      service.submit("app-notexist", "user-001", "leasing_agent")
    ).rejects.toThrow(/not found or not in draft/i);
  });

  it("writes application_submitted audit log", async () => {
    mockQuery.mockResolvedValue({
      rows: [{ id: "app-001", status: "submitted", submitted_at: new Date() }],
    } as any);

    const service = makeService();
    await service.submit("app-001", "user-sub-001", "senior_manager");

    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "application_submitted",
        actorId: "user-sub-001",
        actorRole: "senior_manager",
        applicationId: "app-001",
        details: { status: "submitted" },
      })
    );
  });

  it("returns the updated row from the query", async () => {
    const submittedRow = { id: "app-001", status: "submitted", submitted_at: new Date() };
    mockQuery.mockResolvedValue({ rows: [submittedRow] } as any);

    const service = makeService();
    const result = await service.submit("app-001", "user-001", "leasing_agent");

    expect(result).toEqual(submittedRow);
  });
});

// ── getById() ──────────────────────────────────────────────────────────────

describe("ApplicationService.getById()", () => {
  beforeEach(() => mockQuery.mockReset());

  it("returns null when application is not found", async () => {
    mockQuery.mockResolvedValue({ rows: [] } as any);

    const service = makeService();
    const result = await service.getById("app-notexist");

    expect(result).toBeNull();
  });

  it("strips ssn_encrypted and date_of_birth_encrypted from response (PCI-DSS / FCRA)", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          id: "app-001",
          first_name: "Jane",
          ssn_encrypted: "enc:super-secret",
          date_of_birth_encrypted: "enc:dob-secret",
          ssn_hash: "abcd1234",
          status: "draft",
        },
      ],
    } as any);

    const service = makeService();
    const result = await service.getById("app-001");

    expect(result).not.toHaveProperty("ssn_encrypted");
    expect(result).not.toHaveProperty("date_of_birth_encrypted");
  });

  it("adds ssn_masked using maskSSN (only last-4 visible to staff)", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          id: "app-001",
          ssn_encrypted: "enc:secret",
          date_of_birth_encrypted: "enc:dob",
          ssn_hash: "abcdef12",
          status: "draft",
        },
      ],
    } as any);

    const service = makeService();
    const result = await service.getById("app-001");

    expect(result.ssn_masked).toBeDefined();
    expect(mockMaskSSN).toHaveBeenCalled();
  });

  it("returns the application with property join fields intact", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          id: "app-001",
          first_name: "Jane",
          ssn_encrypted: "enc:x",
          date_of_birth_encrypted: "enc:y",
          ssn_hash: "abcd1234",
          property_name: "Sunset Apartments",
          property_address: "100 Main St",
          status: "submitted",
        },
      ],
    } as any);

    const service = makeService();
    const result = await service.getById("app-001");

    expect(result.property_name).toBe("Sunset Apartments");
    expect(result.property_address).toBe("100 Main St");
    expect(result.id).toBe("app-001");
  });

  it("queries by applicationId", async () => {
    mockQuery.mockResolvedValue({ rows: [] } as any);

    const service = makeService();
    await service.getById("app-xyz");

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("WHERE a.id = $1"),
      ["app-xyz"]
    );
  });
});

// ── list() ─────────────────────────────────────────────────────────────────

describe("ApplicationService.list()", () => {
  beforeEach(() => mockQuery.mockReset());

  function mockListQueries(rows: any[], count: number) {
    // list() calls query twice in parallel (data + count)
    mockQuery
      .mockResolvedValueOnce({ rows } as any)
      .mockResolvedValueOnce({ rows: [{ count: String(count) }] } as any);
  }

  it("returns applications array and total count", async () => {
    mockListQueries([{ id: "app-001" }, { id: "app-002" }], 2);

    const service = makeService();
    const result = await service.list({});

    expect(result.applications).toHaveLength(2);
    expect(result.total).toBe(2);
  });

  it("returns empty applications with total 0 when none match", async () => {
    mockListQueries([], 0);

    const service = makeService();
    const result = await service.list({ status: "cancelled" });

    expect(result.applications).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("applies propertyId filter when provided", async () => {
    mockListQueries([], 0);

    const service = makeService();
    await service.list({ propertyId: "prop-001" });

    const dataQueryCall = mockQuery.mock.calls[0];
    expect(dataQueryCall[0]).toContain("a.property_id = $1");
    expect(dataQueryCall[1]).toContain("prop-001");
  });

  it("applies status filter when provided", async () => {
    mockListQueries([], 0);

    const service = makeService();
    await service.list({ status: "submitted" });

    const dataQueryCall = mockQuery.mock.calls[0];
    expect(dataQueryCall[0]).toContain("a.status = $");
    expect(dataQueryCall[1]).toContain("submitted");
  });

  it("uses default limit=50 and offset=0 when not provided", async () => {
    mockListQueries([], 0);

    const service = makeService();
    await service.list({});

    const dataQueryParams = mockQuery.mock.calls[0][1] as unknown[];
    // With no filters, params are just [limit, offset]
    expect(dataQueryParams).toContain(50);
    expect(dataQueryParams).toContain(0);
  });

  it("respects custom limit and offset", async () => {
    mockListQueries([], 0);

    const service = makeService();
    await service.list({ limit: 10, offset: 20 });

    const dataQueryParams = mockQuery.mock.calls[0][1] as unknown[];
    expect(dataQueryParams).toContain(10);
    expect(dataQueryParams).toContain(20);
  });

  it("combines propertyId and status filters together", async () => {
    mockListQueries([], 0);

    const service = makeService();
    await service.list({ propertyId: "prop-abc", status: "draft" });

    const dataQueryCall = mockQuery.mock.calls[0];
    expect(dataQueryCall[0]).toContain("a.property_id = $1");
    expect(dataQueryCall[0]).toContain("a.status = $2");
    expect(dataQueryCall[1]).toEqual(["prop-abc", "draft", 50, 0]);
  });
});

// ── update() ───────────────────────────────────────────────────────────────

describe("ApplicationService.update()", () => {
  beforeEach(() => mockQuery.mockReset());

  it("throws when no fields are provided to update", async () => {
    const service = makeService();
    await expect(service.update("app-001", {})).rejects.toThrow(/no fields to update/i);

    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("throws when application is not found or not in draft status", async () => {
    mockQuery.mockResolvedValue({ rows: [] } as any);

    const service = makeService();
    await expect(
      service.update("app-001", { firstName: "Janet" })
    ).rejects.toThrow(/not found or not in draft/i);
  });

  it("returns updated row when update succeeds", async () => {
    mockQuery.mockResolvedValue({
      rows: [{ id: "app-001", status: "draft" }],
    } as any);

    const service = makeService();
    const result = await service.update("app-001", { firstName: "Janet" });

    expect(result.id).toBe("app-001");
  });

  it("maps camelCase input fields to snake_case DB columns", async () => {
    mockQuery.mockResolvedValue({
      rows: [{ id: "app-001", status: "draft" }],
    } as any);

    const service = makeService();
    await service.update("app-001", {
      firstName: "Janet",
      annualIncome: 48000,
      currentState: "NV",
    });

    const sqlQuery = mockQuery.mock.calls[0][0] as string;
    expect(sqlQuery).toContain("first_name =");
    expect(sqlQuery).toContain("annual_income =");
    expect(sqlQuery).toContain("current_state =");
  });

  it("only includes provided fields in the SET clause (partial update)", async () => {
    mockQuery.mockResolvedValue({
      rows: [{ id: "app-001", status: "draft" }],
    } as any);

    const service = makeService();
    await service.update("app-001", { firstName: "Janet" }); // only firstName

    const sqlQuery = mockQuery.mock.calls[0][0] as string;
    // Should have exactly one SET clause item
    expect(sqlQuery).toContain("first_name =");
    expect(sqlQuery).not.toContain("last_name =");
    expect(sqlQuery).not.toContain("email =");
  });

  it("restricts update to applications in draft status", async () => {
    mockQuery.mockResolvedValue({ rows: [] } as any);

    const service = makeService();
    try {
      await service.update("app-001", { firstName: "Janet" });
    } catch {
      // expected
    }

    const sqlQuery = mockQuery.mock.calls[0][0] as string;
    expect(sqlQuery).toContain("status = 'draft'");
  });
});

// ── cancel() ───────────────────────────────────────────────────────────────
//
// The 'cancelled' status enables applicant withdrawals and administrative
// closures. Cancelled apps are excluded from duplicate-SSN checks, allowing
// the same applicant to reapply without triggering a fraud flag.

describe("ApplicationService.cancel()", () => {
  beforeEach(() => mockQuery.mockReset());

  it("sets status to cancelled and returns the updated row", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: "app-001", status: "cancelled" }] } as any) // UPDATE
      .mockResolvedValueOnce({ rows: [] } as any); // writeAuditLog (via query mock)

    const service = makeService();
    const result = await service.cancel("app-001", "user-mgr-001", "senior_manager");

    expect(result.id).toBe("app-001");
    expect(result.status).toBe("cancelled");
  });

  it("throws when application is not found or status is not cancellable", async () => {
    mockQuery.mockResolvedValue({ rows: [] } as any);

    const service = makeService();
    await expect(
      service.cancel("app-999", "user-mgr-001", "senior_manager")
    ).rejects.toThrow(/not found or cannot be cancelled/i);
  });

  it("uses ANY($2::application_status[]) to check cancellable statuses", async () => {
    mockQuery.mockResolvedValue({ rows: [] } as any);

    const service = makeService();
    try {
      await service.cancel("app-001", "user-mgr-001", "senior_manager");
    } catch {
      // expected
    }

    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toContain("status = ANY(");
    expect(sql).toContain("'cancelled'");
  });

  it("writes application_cancelled audit log with actorId and actorRole", async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: "app-001", status: "cancelled" }] } as any);

    const service = makeService();
    await service.cancel("app-001", "user-mgr-001", "senior_manager", "applicant withdrew");

    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "application_cancelled",
        actorId: "user-mgr-001",
        actorRole: "senior_manager",
        applicationId: "app-001",
      })
    );
  });

  it("includes reason in audit log details when provided", async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: "app-001", status: "cancelled" }] } as any);

    const service = makeService();
    await service.cancel("app-001", "user-001", "regional_manager", "duplicate application");

    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({ reason: "duplicate application" }),
      })
    );
  });

  it("stores null reason in audit log when reason is omitted", async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: "app-001", status: "cancelled" }] } as any);

    const service = makeService();
    await service.cancel("app-001", "user-001", "senior_manager");

    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({ reason: null }),
      })
    );
  });
});
