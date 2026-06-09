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

import type { QueryResult, PoolClient } from "pg";
import { ApplicationService } from "../modules/application/service";
import { query, transaction } from "../config/database";
import { encrypt, hashSSN, maskSSN } from "../utils/encryption";
import { writeAuditLog } from "../middleware/audit";
import { transitionApplicationStatus } from "../modules/screening/state-machine";

/** Wrap rows in a minimal QueryResult shape without casting to `any`. */
function qr<T extends Record<string, unknown>>(rows: T[]): QueryResult<T> {
  return { rows } as unknown as QueryResult<T>;
}
/** Build a minimal PoolClient stub for transaction mocks. */
function makeClient(queryImpl: jest.Mock): PoolClient {
  return { query: queryImpl } as unknown as PoolClient;
}

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

// Auto-screening-on-submit collaborators (SCREENING_ON_SUBMIT_ENABLED path).
// state-machine mocked inline (no out-of-scope ref → no TDZ); ScreeningService
// reads mockRunFullScreening lazily inside the per-construction impl closure.
const mockRunFullScreening = jest.fn();
jest.mock("../modules/screening/state-machine", () => ({
  transitionApplicationStatus: jest.fn(),
}));
jest.mock("../modules/screening/service", () => ({
  ScreeningService: jest.fn().mockImplementation(() => ({
    runFullScreening: mockRunFullScreening,
  })),
}));

// Consumer-report CRA capture collaborators (CONSUMER_REPORT_ENABLED path).
// The consent module + both CRA clients are mocked; references are deferred into
// closures so the `mock`-prefixed vars are read lazily (no hoist TDZ).
const mockGetAuthorization = jest.fn();
const mockRecordAuthorization = jest.fn();
const mockBgCreateReport = jest.fn();
const mockCreditCreateReport = jest.fn();
const mockBgIsConfigured = jest.fn();
const mockCreditIsConfigured = jest.fn();
jest.mock("../modules/screening/consumer-report-consent", () => ({
  getAuthorization: (...a: unknown[]) => mockGetAuthorization(...a),
  recordAuthorization: (...a: unknown[]) => mockRecordAuthorization(...a),
  getDisclosure: () => ({ version: "2026-06-01", text: "DISCLOSURE", hash: "h" }),
  FCRA_DISCLOSURE_VERSION: "2026-06-01",
}));
jest.mock("../modules/screening/background-check", () => ({
  BackgroundCheckService: jest.fn().mockImplementation(() => ({
    createReport: (...a: unknown[]) => mockBgCreateReport(...a),
    isConfigured: (...a: unknown[]) => mockBgIsConfigured(...a),
  })),
}));
jest.mock("../modules/screening/credit-check", () => ({
  CreditCheckService: jest.fn().mockImplementation(() => ({
    createReport: (...a: unknown[]) => mockCreditCreateReport(...a),
    isConfigured: (...a: unknown[]) => mockCreditIsConfigured(...a),
  })),
}));

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockTransaction = transaction as jest.MockedFunction<typeof transaction>;
const mockEncrypt = encrypt as jest.MockedFunction<typeof encrypt>;
const mockHashSSN = hashSSN as jest.MockedFunction<typeof hashSSN>;
const mockMaskSSN = maskSSN as jest.MockedFunction<typeof maskSSN>;
const mockWriteAuditLog = writeAuditLog as jest.MockedFunction<typeof writeAuditLog>;
const mockTransition = transitionApplicationStatus as jest.MockedFunction<
  typeof transitionApplicationStatus
>;

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
    mockTransaction.mockImplementation(async (fn) => fn(makeClient(jest.fn().mockResolvedValue(qr([{ id: "app-001", status: "draft", created_at: new Date() }])))));

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
    mockTransaction.mockImplementation(async (fn) => fn(makeClient(clientQuery)));

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
      fn(makeClient(jest.fn().mockResolvedValue(qr([{ id: "app-001", status: "draft", created_at: new Date() }]))))
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

    const mockClient = makeClient(jest.fn().mockResolvedValue(qr([{ id: "app-002", status: "draft", created_at: new Date() }])));
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
      fn(makeClient(jest.fn().mockResolvedValue(qr([{ id: "app-003", status: "draft", created_at: new Date() }]))))
    );

    const service = makeService();
    await service.create(minimalInput(), "user-001", "leasing_agent");

    expect(mockRaiseFraudFlag).not.toHaveBeenCalled();
  });

  it("checks address fraud when currentAddressLine1 is provided", async () => {
    mockCheckDuplicateSSN.mockResolvedValue({ isDuplicate: false, existingApplicationIds: [] });
    const mockClient = makeClient(jest.fn().mockResolvedValue(qr([{ id: "app-004", status: "draft", created_at: new Date() }])));
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
      fn(makeClient(jest.fn().mockResolvedValue(qr([{ id: "app-005", status: "draft", created_at: new Date() }]))))
    );

    const service = makeService();
    await service.create(minimalInput(), "user-001", "leasing_agent"); // no address

    expect(mockCheckAddressFraud).not.toHaveBeenCalled();
  });

  it("writes application_created audit log with masked SSN", async () => {
    mockCheckDuplicateSSN.mockResolvedValue({ isDuplicate: false, existingApplicationIds: [] });
    mockTransaction.mockImplementation(async (fn) =>
      fn(makeClient(jest.fn().mockResolvedValue(qr([{ id: "app-006", status: "draft", created_at: new Date() }]))))
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
      fn(makeClient(jest.fn().mockResolvedValue({ rows: [createdRow] })))
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
    mockQuery.mockResolvedValue(qr([{ id: "app-001", status: "submitted", submitted_at: new Date() }]));

    const service = makeService();
    const result = await service.submit("app-001", "user-001", "leasing_agent");

    expect(result.status).toBe("submitted");
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("status = 'submitted'"),
      ["app-001", "user-001"]
    );
  });

  it("throws when application is not found or not in draft status", async () => {
    mockQuery.mockResolvedValue(qr([]));

    const service = makeService();
    await expect(
      service.submit("app-notexist", "user-001", "leasing_agent")
    ).rejects.toThrow(/not found or not in draft/i);
  });

  it("writes application_submitted audit log", async () => {
    mockQuery.mockResolvedValue(qr([{ id: "app-001", status: "submitted", submitted_at: new Date() }]));

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
    mockQuery.mockResolvedValue(qr([submittedRow]));

    const service = makeService();
    const result = await service.submit("app-001", "user-001", "leasing_agent");

    expect(result).toEqual(submittedRow);
  });
});

// ── submit() — auto-screening on submit (SCREENING_ON_SUBMIT_ENABLED) ────────

describe("ApplicationService.submit() — auto-screening on submit", () => {
  const ORIGINAL_FLAG = process.env.SCREENING_ON_SUBMIT_ENABLED;
  const flush = () => new Promise((r) => setImmediate(r));

  beforeEach(() => {
    mockQuery.mockReset();
    mockWriteAuditLog.mockReset();
    mockTransition.mockReset();
    mockRunFullScreening.mockReset();
    mockRunFullScreening.mockResolvedValue(undefined);
    mockTransition.mockResolvedValue({ changed: true, status: "screening" } as any);
  });

  afterEach(() => {
    if (ORIGINAL_FLAG === undefined) delete process.env.SCREENING_ON_SUBMIT_ENABLED;
    else process.env.SCREENING_ON_SUBMIT_ENABLED = ORIGINAL_FLAG;
  });

  it("flag off ⇒ no chokepoint transition, no screening kickoff (byte-for-byte legacy)", async () => {
    delete process.env.SCREENING_ON_SUBMIT_ENABLED;
    mockQuery.mockResolvedValue(qr([{ id: "app-001", status: "submitted", submitted_at: new Date() }]));

    const service = makeService();
    const result = await service.submit("app-001", "user-001", "leasing_agent");
    await flush();

    expect(result.status).toBe("submitted");
    expect(mockTransition).not.toHaveBeenCalled();
    expect(mockRunFullScreening).not.toHaveBeenCalled();
  });

  it("flag on ⇒ advances submitted→screening through the chokepoint and kicks runFullScreening", async () => {
    process.env.SCREENING_ON_SUBMIT_ENABLED = "true";
    mockQuery.mockResolvedValue(qr([{ id: "app-001", status: "submitted", submitted_at: new Date() }]));

    const service = makeService();
    const result = await service.submit("app-001", "user-001", "leasing_agent");

    // submit() still returns the submitted row synchronously.
    expect(result.status).toBe("submitted");
    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationId: "app-001",
        from: "submitted",
        to: "screening",
        trigger: "screening_started",
      })
    );

    // Fire-and-forget kickoff: flush microtasks so the void promise resolves.
    await flush();
    expect(mockRunFullScreening).toHaveBeenCalledWith("app-001", "user-001", "leasing_agent");
  });

  it("flag on + pipeline throws ⇒ submit() still resolves; app left in screening (non-approvable)", async () => {
    process.env.SCREENING_ON_SUBMIT_ENABLED = "true";
    mockQuery.mockResolvedValue(qr([{ id: "app-001", status: "submitted", submitted_at: new Date() }]));
    mockRunFullScreening.mockRejectedValue(new Error("vendor down"));

    const service = makeService();
    // Must NOT reject — a screening failure never surfaces to the applicant.
    const result = await service.submit("app-001", "user-001", "leasing_agent");
    await flush();

    expect(result.status).toBe("submitted");
    expect(mockTransition).toHaveBeenCalledTimes(1);
    expect(mockRunFullScreening).toHaveBeenCalled();
  });
});

// ── submit() — FCRA consumer-report consent (CONSUMER_REPORT_ENABLED) ─────────

describe("ApplicationService.submit() — FCRA consumer-report consent", () => {
  const ORIGINAL_FLAG = process.env.CONSUMER_REPORT_ENABLED;
  const submittedRow = { id: "app-001", status: "submitted", submitted_at: new Date() };
  const applicantRow = {
    first_name: "Jane",
    last_name: "Doe",
    ssn_encrypted: null,
    date_of_birth_encrypted: null,
    current_state: "NV",
  };

  /** Grab the persist-UPDATE call that stamps screening_authorization_at = $6. */
  function authStampParams() {
    const call = mockQuery.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].includes("screening_authorization_at = $6")
    );
    return call ? (call[1] as unknown[]) : undefined;
  }

  beforeEach(() => {
    mockQuery.mockReset();
    mockWriteAuditLog.mockReset();
    mockTransition.mockReset();
    mockGetAuthorization.mockReset();
    mockRecordAuthorization.mockReset();
    mockBgCreateReport.mockReset();
    mockCreditCreateReport.mockReset();
    mockBgIsConfigured.mockReset();
    mockCreditIsConfigured.mockReset();
    mockTransition.mockResolvedValue({ changed: true, status: "awaiting_consumer_report" } as any);
    mockBgCreateReport.mockResolvedValue({ reportId: "bg_1", status: "pending", url: "https://bg" });
    mockCreditCreateReport.mockResolvedValue({ reportId: "cr_1", status: "pending", url: "https://cr" });
    // Both CRA vendors armed by default; the partial-arm preflight is exercised
    // explicitly in its own test below.
    mockBgIsConfigured.mockReturnValue(true);
    mockCreditIsConfigured.mockReturnValue(true);
  });

  afterEach(() => {
    if (ORIGINAL_FLAG === undefined) delete process.env.CONSUMER_REPORT_ENABLED;
    else process.env.CONSUMER_REPORT_ENABLED = ORIGINAL_FLAG;
  });

  it("flag off ⇒ consent ignored, no authorization, no report orders (byte-identical)", async () => {
    delete process.env.CONSUMER_REPORT_ENABLED;
    mockQuery.mockResolvedValue(qr([submittedRow]));

    const service = makeService();
    const result = await service.submit("app-001", "user-001", "applicant", undefined, {
      authorized: true,
      disclosureVersion: "2026-06-01",
    });

    expect(result.status).toBe("submitted");
    expect(mockRecordAuthorization).not.toHaveBeenCalled();
    expect(mockGetAuthorization).not.toHaveBeenCalled();
    expect(mockBgCreateReport).not.toHaveBeenCalled();
    expect(mockCreditCreateReport).not.toHaveBeenCalled();
  });

  it("flag on + no consent + none on file ⇒ consentRequired, no orders, app stays submitted", async () => {
    process.env.CONSUMER_REPORT_ENABLED = "true";
    mockQuery.mockResolvedValue(qr([submittedRow])); // only the status UPDATE runs
    mockGetAuthorization.mockResolvedValue(null);

    const service = makeService();
    const result = await service.submit("app-001", "user-001", "applicant");

    expect(result.consumerReportConsentRequired).toBe(true);
    expect(result.status).toBe("submitted");
    expect(mockRecordAuthorization).not.toHaveBeenCalled();
    expect(mockBgCreateReport).not.toHaveBeenCalled();
    expect(mockTransition).not.toHaveBeenCalled();
  });

  it("flag on + consent affirmed ⇒ records authorization, stamps screening_authorization_at to it, creates orders", async () => {
    process.env.CONSUMER_REPORT_ENABLED = "true";
    const authorizedAt = "2026-06-01T10:00:00.000Z";
    mockRecordAuthorization.mockResolvedValue({ authorizedAt, alreadyRecorded: false });
    mockQuery
      .mockResolvedValueOnce(qr([submittedRow])) // status UPDATE
      .mockResolvedValueOnce(qr([applicantRow])) // appRow SELECT
      .mockResolvedValueOnce(qr([])); // persist UPDATE

    const service = makeService();
    const result = await service.submit("app-001", "user-001", "applicant", undefined, {
      authorized: true,
      disclosureVersion: "2026-06-01",
      ip: "9.9.9.9",
      userAgent: "UA/1.0",
    });

    expect(result.status).toBe("awaiting_consumer_report");
    expect(mockRecordAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationId: "app-001",
        applicantId: "user-001",
        applicantRole: "applicant",
        disclosureVersion: "2026-06-01",
        ip: "9.9.9.9",
        userAgent: "UA/1.0",
      })
    );
    expect(mockBgCreateReport).toHaveBeenCalled();
    expect(mockCreditCreateReport).toHaveBeenCalled();

    // The pull is stamped with the AUTHORIZATION timestamp, not order-creation NOW().
    const params = authStampParams();
    expect(params).toBeDefined();
    expect(params![5]).toBe(authorizedAt);
  });

  it("flag on + valid authorization already on file (no fresh consent) ⇒ uses stored authorizedAt, creates orders", async () => {
    process.env.CONSUMER_REPORT_ENABLED = "true";
    const storedAt = "2026-05-30T09:00:00.000Z";
    mockGetAuthorization.mockResolvedValue({
      applicationId: "app-001",
      applicantId: "user-001",
      disclosureVersion: "2026-06-01",
      disclosureHash: "h",
      method: "in_app_checkbox",
      authorizedAt: storedAt,
    });
    mockQuery
      .mockResolvedValueOnce(qr([submittedRow]))
      .mockResolvedValueOnce(qr([applicantRow]))
      .mockResolvedValueOnce(qr([]));

    const service = makeService();
    const result = await service.submit("app-001", "user-001", "applicant"); // no consent arg

    expect(result.status).toBe("awaiting_consumer_report");
    expect(mockRecordAuthorization).not.toHaveBeenCalled(); // reused existing
    expect(mockBgCreateReport).toHaveBeenCalled();
    const params = authStampParams();
    expect(params![5]).toBe(storedAt);
  });

  it("flag on + consent against a superseded disclosure version ⇒ consentRequired, no orders", async () => {
    process.env.CONSUMER_REPORT_ENABLED = "true";
    mockQuery.mockResolvedValue(qr([submittedRow]));

    const service = makeService();
    const result = await service.submit("app-001", "user-001", "applicant", undefined, {
      authorized: true,
      disclosureVersion: "2020-01-01", // stale
    });

    expect(result.consumerReportConsentRequired).toBe(true);
    expect(mockRecordAuthorization).not.toHaveBeenCalled();
    expect(mockBgCreateReport).not.toHaveBeenCalled();
    expect(mockTransition).not.toHaveBeenCalled();
  });

  it("flag on + consent affirmed but a CRA vendor not configured ⇒ no orders, no transition, app stays submitted (no orphaned Checkr candidate)", async () => {
    // The #270 reality: Checkr is armed but the TransUnion credit adapter (#273)
    // is not yet credentialed. The atomic readiness preflight must refuse to fire
    // EITHER outbound order — otherwise Checkr's createReport would strand a
    // billed, applicant-emailed candidate the failed credit order can't be paired
    // with, and every resubmit would orphan another.
    process.env.CONSUMER_REPORT_ENABLED = "true";
    mockBgIsConfigured.mockReturnValue(true);
    mockCreditIsConfigured.mockReturnValue(false);
    mockRecordAuthorization.mockResolvedValue({
      authorizedAt: "2026-06-01T10:00:00.000Z",
      alreadyRecorded: false,
    });
    mockQuery.mockResolvedValue(qr([submittedRow]));

    const service = makeService();
    const result = await service.submit("app-001", "user-001", "applicant", undefined, {
      authorized: true,
      disclosureVersion: "2026-06-01",
    });

    expect(result.status).toBe("submitted");
    expect(mockBgCreateReport).not.toHaveBeenCalled();
    expect(mockCreditCreateReport).not.toHaveBeenCalled();
    expect(mockTransition).not.toHaveBeenCalled();
  });
});

// ── getById() ──────────────────────────────────────────────────────────────

describe("ApplicationService.getById()", () => {
  beforeEach(() => mockQuery.mockReset());

  it("returns null when application is not found", async () => {
    mockQuery.mockResolvedValue(qr([]));

    const service = makeService();
    const result = await service.getById("app-notexist");

    expect(result).toBeNull();
  });

  it("strips ssn_encrypted and date_of_birth_encrypted from response (PCI-DSS / FCRA)", async () => {
    mockQuery.mockResolvedValue(qr([{ id: "app-001", first_name: "Jane", ssn_encrypted: "enc:super-secret", date_of_birth_encrypted: "enc:dob-secret", ssn_hash: "abcd1234", status: "draft" }]));

    const service = makeService();
    const result = await service.getById("app-001");

    expect(result).not.toHaveProperty("ssn_encrypted");
    expect(result).not.toHaveProperty("date_of_birth_encrypted");
  });

  it("adds ssn_masked using maskSSN (only last-4 visible to staff)", async () => {
    mockQuery.mockResolvedValue(qr([{ id: "app-001", ssn_encrypted: "enc:secret", date_of_birth_encrypted: "enc:dob", ssn_hash: "abcdef12", status: "draft" }]));

    const service = makeService();
    const result = await service.getById("app-001");

    expect(result.ssn_masked).toBeDefined();
    expect(mockMaskSSN).toHaveBeenCalled();
  });

  it("returns the application with property join fields intact", async () => {
    mockQuery.mockResolvedValue(qr([{ id: "app-001", first_name: "Jane", ssn_encrypted: "enc:x", date_of_birth_encrypted: "enc:y", ssn_hash: "abcd1234", property_name: "Sunset Apartments", property_address: "100 Main St", status: "submitted" }]));

    const service = makeService();
    const result = await service.getById("app-001");

    expect(result.property_name).toBe("Sunset Apartments");
    expect(result.property_address).toBe("100 Main St");
    expect(result.id).toBe("app-001");
  });

  it("queries by applicationId", async () => {
    mockQuery.mockResolvedValue(qr([]));

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

  function mockListQueries(rows: Record<string, unknown>[], count: number) {
    // list() calls query twice in parallel (data + count)
    mockQuery
      .mockResolvedValueOnce(qr(rows))
      .mockResolvedValueOnce(qr([{ count: String(count) }]));
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
    mockQuery.mockResolvedValue(qr([]));

    const service = makeService();
    await expect(
      service.update("app-001", { firstName: "Janet" })
    ).rejects.toThrow(/not found or not in draft/i);
  });

  it("returns updated row when update succeeds", async () => {
    mockQuery.mockResolvedValue(qr([{ id: "app-001", status: "draft" }]));

    const service = makeService();
    const result = await service.update("app-001", { firstName: "Janet" });

    expect(result.id).toBe("app-001");
  });

  it("maps camelCase input fields to snake_case DB columns", async () => {
    mockQuery.mockResolvedValue(qr([{ id: "app-001", status: "draft" }]));

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
    mockQuery.mockResolvedValue(qr([{ id: "app-001", status: "draft" }]));

    const service = makeService();
    await service.update("app-001", { firstName: "Janet" }); // only firstName

    const sqlQuery = mockQuery.mock.calls[0][0] as string;
    // Should have exactly one SET clause item
    expect(sqlQuery).toContain("first_name =");
    expect(sqlQuery).not.toContain("last_name =");
    expect(sqlQuery).not.toContain("email =");
  });

  it("restricts update to applications in draft status", async () => {
    mockQuery.mockResolvedValue(qr([]));

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
      .mockResolvedValueOnce(qr([{ id: "app-001", status: "cancelled" }])) // UPDATE
      .mockResolvedValueOnce(qr([])); // writeAuditLog (via query mock)

    const service = makeService();
    const result = await service.cancel("app-001", "user-mgr-001", "senior_manager");

    expect(result.id).toBe("app-001");
    expect(result.status).toBe("cancelled");
  });

  it("throws when application is not found or status is not cancellable", async () => {
    mockQuery.mockResolvedValue(qr([]));

    const service = makeService();
    await expect(
      service.cancel("app-999", "user-mgr-001", "senior_manager")
    ).rejects.toThrow(/not found or cannot be cancelled/i);
  });

  it("uses ANY($2::application_status[]) to check cancellable statuses", async () => {
    mockQuery.mockResolvedValue(qr([]));

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
    mockQuery.mockResolvedValue(qr([{ id: "app-001", status: "cancelled" }]));

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
    mockQuery.mockResolvedValue(qr([{ id: "app-001", status: "cancelled" }]));

    const service = makeService();
    await service.cancel("app-001", "user-001", "regional_manager", "duplicate application");

    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({ reason: "duplicate application" }),
      })
    );
  });

  it("stores null reason in audit log when reason is omitted", async () => {
    mockQuery.mockResolvedValue(qr([{ id: "app-001", status: "cancelled" }]));

    const service = makeService();
    await service.cancel("app-001", "user-001", "senior_manager");

    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({ reason: null }),
      })
    );
  });
});

// ── verifyIncome() ─────────────────────────────────────────────────────────
//
// LIHTC §42 requires income verification through third-party sources
// (W-2, pay stubs, employer letter) before lease generation.
// This method sets income_verified = true and optionally updates annual_income.

describe("ApplicationService.verifyIncome()", () => {
  beforeEach(() => mockQuery.mockReset());

  it("throws when application is not found", async () => {
    mockQuery.mockResolvedValueOnce(qr([])); // SELECT not found

    const service = makeService();
    await expect(
      service.verifyIncome("app-999", "user-mgr-001", "senior_manager")
    ).rejects.toThrow(/application not found/i);
  });

  it("throws when application status is terminal (e.g. cancelled)", async () => {
    mockQuery.mockResolvedValueOnce(qr([{ id: "app-001", status: "cancelled", annual_income: "40000" }]));

    const service = makeService();
    await expect(
      service.verifyIncome("app-001", "user-mgr-001", "senior_manager")
    ).rejects.toThrow(/cannot be verified.*status/i);
  });

  it("sets income_verified=true and returns updated row", async () => {
    mockQuery
      .mockResolvedValueOnce(qr([{ id: "app-001", status: "tier1_approved", annual_income: "40000" }]))
      .mockResolvedValueOnce(qr([{ id: "app-001", status: "tier1_approved", income_verified: true, annual_income: "40000" }]));

    const service = makeService();
    const result = await service.verifyIncome("app-001", "user-mgr-001", "senior_manager");

    expect(result.income_verified).toBe(true);
  });

  it("UPDATE includes income_verified=true, income_verified_by, income_verified_at", async () => {
    mockQuery
      .mockResolvedValueOnce(qr([{ id: "app-001", status: "screening_passed", annual_income: "35000" }]))
      .mockResolvedValueOnce(qr([{ id: "app-001", income_verified: true, annual_income: "35000" }]));

    const service = makeService();
    await service.verifyIncome("app-001", "user-mgr-001", "senior_manager");

    const sql = mockQuery.mock.calls[1]![0] as string;
    expect(sql).toMatch(/income_verified = true/);
    expect(sql).toMatch(/income_verified_by/);
    expect(sql).toMatch(/income_verified_at = NOW\(\)/);
  });

  it("includes verified income amount in UPDATE when verifiedIncome is provided", async () => {
    mockQuery
      .mockResolvedValueOnce(qr([{ id: "app-001", status: "tier1_approved", annual_income: "35000" }]))
      .mockResolvedValueOnce(qr([{ id: "app-001", income_verified: true, annual_income: "37500" }]));

    const service = makeService();
    await service.verifyIncome("app-001", "user-mgr-001", "senior_manager", 37500);

    const sql = mockQuery.mock.calls[1]![0] as string;
    const params = mockQuery.mock.calls[1]![1] as unknown[];
    expect(sql).toMatch(/annual_income = \$\d/);
    expect(params).toContain(37500);
  });

  it("does NOT include annual_income in UPDATE when verifiedIncome is omitted", async () => {
    mockQuery
      .mockResolvedValueOnce(qr([{ id: "app-001", status: "draft", annual_income: "40000" }]))
      .mockResolvedValueOnce(qr([{ id: "app-001", income_verified: true, annual_income: "40000" }]));

    const service = makeService();
    await service.verifyIncome("app-001", "user-mgr-001", "senior_manager");

    const sql = mockQuery.mock.calls[1]![0] as string;
    expect(sql).not.toMatch(/annual_income = \$/);
  });

  it("writes income_verified audit log with actorId, actorRole, and previousIncome", async () => {
    mockQuery
      .mockResolvedValueOnce(qr([{ id: "app-001", status: "tier1_approved", annual_income: "42000" }]))
      .mockResolvedValueOnce(qr([{ id: "app-001", income_verified: true, annual_income: "44000" }]));

    const service = makeService();
    await service.verifyIncome("app-001", "user-mgr-001", "regional_manager", 44000);

    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "income_verified",
        actorId: "user-mgr-001",
        actorRole: "regional_manager",
        applicationId: "app-001",
        details: expect.objectContaining({ verifiedIncome: 44000, previousIncome: 42000 }),
      })
    );
  });
});
