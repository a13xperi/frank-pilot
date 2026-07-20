/**
 * Tests for applyApplicationFeePaid's POSITIVE screening path — the detached
 * fire-and-forget block in apply-fee.ts. With consent on file and a real
 * submitter, paying the fee must flip draft → submitted (stamping
 * screening_authorization_at) and run runFullScreening(applicationId,
 * submittedBy, 'applicant'). The sibling suite (apply-fee-dedup.test.ts)
 * covers the dedupe guard and the held/no-consent path; this one asserts the
 * side effects themselves, which run inside a void (async () => …)() the
 * caller never awaits — so every test flushes the macrotask queue to observe
 * them.
 */
const mockQuery = jest.fn();
const mockRecordPayment = jest.fn();
const mockHasAuth = jest.fn();
const mockRunScreening = jest.fn();
const mockStampTape = jest.fn();
const mockWriteAudit = jest.fn();
const mockRecordLedgerEntry = jest.fn();

jest.mock("../config/database", () => ({ query: (...a: unknown[]) => mockQuery(...a) }));
jest.mock("../utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock("../middleware/audit", () => ({ writeAuditLog: (...a: unknown[]) => mockWriteAudit(...a) }));
jest.mock("../modules/tape", () => ({ stampTape: (...a: unknown[]) => mockStampTape(...a) }));
jest.mock("../modules/ledger/service", () => ({
  LedgerService: jest.fn().mockImplementation(() => ({ recordPayment: (...a: unknown[]) => mockRecordPayment(...a) })),
}));
jest.mock("../modules/screening/consumer-report-consent", () => ({ hasValidAuthorization: (...a: unknown[]) => mockHasAuth(...a) }));
jest.mock("../modules/screening/service", () => ({
  ScreeningService: jest.fn().mockImplementation(() => ({ runFullScreening: (...a: unknown[]) => mockRunScreening(...a) })),
}));
jest.mock("../modules/relationship/ledger", () => ({ recordLedgerEntry: (...a: unknown[]) => mockRecordLedgerEntry(...a) }));

import { applyApplicationFeePaid } from "../modules/payment/apply-fee";
import { logger } from "../utils/logger";

/** Let the detached void (async () => …)() inside apply-fee run to completion. */
const flushDetached = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  jest.clearAllMocks();
  mockRecordPayment.mockResolvedValue({ id: "ledger-new" });
  mockHasAuth.mockResolvedValue(true);
  mockRunScreening.mockResolvedValue(undefined);
  mockStampTape.mockResolvedValue(undefined);
  mockWriteAudit.mockResolvedValue(undefined);
  mockRecordLedgerEntry.mockReturnValue(undefined);
});

describe("applyApplicationFeePaid — positive screening path (detached work)", () => {
  it("flips draft → submitted (stamping screening_authorization_at) then fires runFullScreening", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ submitted_by: "u1", status: "draft", phone: "+17025551234" }] }) // actor SELECT
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // the status-flip UPDATE

    const res = await applyApplicationFeePaid({
      applicationId: "app-1",
      amountDollars: 35.95,
      chargeRef: "pi_pos",
      source: "stripe-webhook",
      dedupeOnRef: false,
    });
    await flushDetached();

    expect(res.screeningFired).toBe(true);
    const updateCall = mockQuery.mock.calls[1];
    expect(String(updateCall[0])).toMatch(/UPDATE applications/i);
    expect(String(updateCall[0])).toMatch(/status = 'submitted'/);
    expect(String(updateCall[0])).toMatch(/screening_authorization_at = COALESCE\(screening_authorization_at, NOW\(\)\)/);
    // idempotent: only a draft may flip
    expect(String(updateCall[0])).toMatch(/WHERE id = \$1 AND status = 'draft'/);
    expect(updateCall[1]).toEqual(["app-1", "u1"]);
    expect(mockRunScreening).toHaveBeenCalledWith("app-1", "u1", "applicant");
    // the flip must land before the screening pull (runFullScreening requires submitted)
    expect(mockQuery.mock.invocationCallOrder[1]).toBeLessThan(mockRunScreening.mock.invocationCallOrder[0]);
  });

  it("uses actorIdFallback as the submitter when applications.submitted_by is null", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ submitted_by: null, status: "draft", phone: null }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const res = await applyApplicationFeePaid({
      applicationId: "app-2",
      amountDollars: 35.95,
      chargeRef: "pi_fb",
      source: "stripe-webhook",
      actorIdFallback: "actor-fb",
    });
    await flushDetached();

    expect(res.screeningFired).toBe(true);
    expect(mockQuery.mock.calls[1][1]).toEqual(["app-2", "actor-fb"]);
    expect(mockRunScreening).toHaveBeenCalledWith("app-2", "actor-fb", "applicant");
  });

  it("records fee_paid and screening_started relationship entries against the applicant's phone", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ submitted_by: "u1", status: "draft", phone: "+17025551234" }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await applyApplicationFeePaid({
      applicationId: "app-3",
      amountDollars: 35.95,
      chargeRef: "pi_rel",
      source: "stripe-webhook",
    });
    await flushDetached();

    expect(mockRecordLedgerEntry).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "fee_paid", phoneE164: "+17025551234", ref: "app-3" })
    );
    expect(mockRecordLedgerEntry).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "screening_started", phoneE164: "+17025551234", ref: "app-3" })
    );
  });

  it("swallows a runFullScreening failure — the caller (Stripe/Twilio) is never 500ed", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ submitted_by: "u1", status: "draft", phone: "+1702" }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    mockRunScreening.mockRejectedValueOnce(new Error("vendor down"));

    const res = await applyApplicationFeePaid({
      applicationId: "app-4",
      amountDollars: 35.95,
      chargeRef: "pi_fail",
      source: "stripe-webhook",
    });
    await flushDetached();

    // the sync result already reported screeningFired (the pull was attempted)
    expect(res).toEqual({ ledgerEntryId: "ledger-new", screeningFired: true, deduped: false });
    expect(logger.error).toHaveBeenCalledWith(
      "post-fee screening failed",
      expect.objectContaining({ applicationId: "app-4", error: "vendor down" })
    );
    // tape + audit still stamped with the attempted fire
    expect(mockStampTape).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ screeningFired: true }) })
    );
    expect(mockWriteAudit).toHaveBeenCalled();
  });

  it("swallows a status-flip failure and does not run screening on an unflipped app", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ submitted_by: "u1", status: "draft", phone: "+1702" }] })
      .mockRejectedValueOnce(new Error("db down")); // the UPDATE

    const res = await applyApplicationFeePaid({
      applicationId: "app-5",
      amountDollars: 35.95,
      chargeRef: "pi_flipfail",
      source: "stripe-webhook",
    });
    await flushDetached();

    expect(res.screeningFired).toBe(true); // reported as attempted
    expect(mockRunScreening).not.toHaveBeenCalled(); // but the pull never ran
    expect(logger.error).toHaveBeenCalledWith(
      "post-fee screening failed",
      expect.objectContaining({ applicationId: "app-5", error: "db down" })
    );
  });
});
