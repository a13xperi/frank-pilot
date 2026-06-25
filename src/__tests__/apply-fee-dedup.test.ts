/**
 * Tests for applyApplicationFeePaid's idempotency guard (dedupeOnRef) — the DTMF
 * safety net. Twilio can re-POST the <Pay> /result action callback, and
 * recordPayment does NOT dedupe on reference_id, so a repeat would double-post the
 * ledger. dedupeOnRef:true must short-circuit when a payment row already exists for
 * the chargeRef; dedupeOnRef:false (webhook, fenced upstream) must skip the guard.
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

beforeEach(() => {
  jest.clearAllMocks();
  mockRecordPayment.mockResolvedValue({ id: "ledger-new" });
  mockHasAuth.mockResolvedValue(true);
  mockRunScreening.mockResolvedValue(undefined);
  mockStampTape.mockResolvedValue(undefined);
  mockWriteAudit.mockResolvedValue(undefined);
  mockRecordLedgerEntry.mockReturnValue(undefined);
});

describe("applyApplicationFeePaid — dedupeOnRef guard", () => {
  it("dedupeOnRef:true short-circuits when a payment row already exists for the chargeRef", async () => {
    // first query = the dedup SELECT on tenant_ledger → already present
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "ledger-existing" }] });

    const res = await applyApplicationFeePaid({
      applicationId: "app-1",
      amountDollars: 35.95,
      chargeRef: "ch_dup",
      source: "twilio-pay",
      dedupeOnRef: true,
    });

    expect(res).toEqual({ ledgerEntryId: "ledger-existing", screeningFired: false, deduped: true });
    expect(mockRecordPayment).not.toHaveBeenCalled();
    expect(mockStampTape).not.toHaveBeenCalled();
    // the dedup SELECT must hit tenant_ledger by application_id + reference_id
    expect(String(mockQuery.mock.calls[0][0])).toMatch(/FROM tenant_ledger/i);
    expect(mockQuery.mock.calls[0][1]).toEqual(["app-1", "ch_dup"]);
  });

  it("dedupeOnRef:true proceeds (records payment) when no prior row exists", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // dedup SELECT → none
      .mockResolvedValueOnce({ rows: [{ submitted_by: "u1", status: "draft", phone: "+17025551234" }] }); // actor SELECT

    const res = await applyApplicationFeePaid({
      applicationId: "app-2",
      amountDollars: 35.95,
      chargeRef: "ch_new",
      source: "twilio-pay",
      dedupeOnRef: true,
    });

    expect(res.deduped).toBe(false);
    expect(res.ledgerEntryId).toBe("ledger-new");
    expect(mockRecordPayment).toHaveBeenCalledWith("app-2", 35.95, "ch_new", null, null, expect.any(String));
    expect(mockStampTape).toHaveBeenCalled();
    expect(res.screeningFired).toBe(true); // consent true + submitted_by present
  });

  it("dedupeOnRef:false (webhook) skips the guard SELECT and records directly", async () => {
    // No dedup SELECT — first query is the actor SELECT
    mockQuery.mockResolvedValueOnce({ rows: [{ submitted_by: "u9", status: "draft", phone: null }] });

    const res = await applyApplicationFeePaid({
      applicationId: "app-3",
      amountDollars: 35.95,
      chargeRef: "pi_webhook",
      source: "stripe-webhook",
      dedupeOnRef: false,
    });

    expect(res.deduped).toBe(false);
    expect(mockRecordPayment).toHaveBeenCalledTimes(1);
    // first query must be the actor lookup, NOT a tenant_ledger dedup check
    expect(String(mockQuery.mock.calls[0][0])).toMatch(/FROM applications/i);
  });

  it("holds screening (no runFullScreening) when consent is not on file", async () => {
    mockHasAuth.mockResolvedValue(false);
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ submitted_by: "u1", status: "draft", phone: "+1702" }] });

    const res = await applyApplicationFeePaid({
      applicationId: "app-4",
      amountDollars: 35.95,
      chargeRef: "ch_noconsent",
      source: "twilio-pay",
      dedupeOnRef: true,
    });

    expect(res.screeningFired).toBe(false);
    expect(mockRunScreening).not.toHaveBeenCalled();
    expect(mockRecordPayment).toHaveBeenCalled(); // fee still posted
  });
});
