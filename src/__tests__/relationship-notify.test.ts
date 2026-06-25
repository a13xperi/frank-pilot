/**
 * Tests for the relationship notifier — emails the applicant + records the
 * ledger step on each meaningful status transition, exactly-once, dark by flag.
 */
const mockQuery = jest.fn();
jest.mock("../config/database", () => ({ query: (...a: unknown[]) => mockQuery(...a) }));
jest.mock("../utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

const mockStatusUpdate = jest.fn();
const mockApproved = jest.fn();
const mockDenied = jest.fn();
jest.mock("../modules/integrations/email", () => ({
  getEmailService: () => ({
    sendStatusUpdate: (...a: unknown[]) => mockStatusUpdate(...a),
    sendApproved: (...a: unknown[]) => mockApproved(...a),
    sendDenied: (...a: unknown[]) => mockDenied(...a),
  }),
}));

const mockLedger = jest.fn();
jest.mock("../modules/relationship/ledger", () => ({
  recordLedgerEntry: (...a: unknown[]) => mockLedger(...a),
}));

import { notifyPersonStep } from "../modules/relationship/notify";

const APP = "11111111-1111-1111-1111-111111111111";
beforeEach(() => {
  jest.clearAllMocks();
  process.env.RELATIONSHIP_NOTIFY_ENABLED = "true";
});
afterEach(() => { delete process.env.RELATIONSHIP_NOTIFY_ENABLED; });

describe("notifyPersonStep", () => {
  it("no-ops when the flag is off (dark by default)", async () => {
    delete process.env.RELATIONSHIP_NOTIFY_ENABLED;
    await notifyPersonStep({ applicationId: APP, toStatus: "screening", trigger: "screening_started" });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("no-ops for a status with no applicant-facing copy", async () => {
    await notifyPersonStep({ applicationId: APP, toStatus: "awaiting_identity", trigger: "x" });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("emails a mid-funnel status update + records the ledger step (screening)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ email: "dana@example.com", first_name: "Dana", phone: "+17025551234" }] });
    mockStatusUpdate.mockResolvedValueOnce({ sent: true });
    await notifyPersonStep({ applicationId: APP, toStatus: "screening", trigger: "screening_started" });
    expect(mockStatusUpdate).toHaveBeenCalledTimes(1);
    expect(mockStatusUpdate.mock.calls[0][0]).toBe("dana@example.com");
    const ledger = mockLedger.mock.calls[0][0];
    expect(ledger.eventType).toBe("screening_started");
    expect(ledger.channel).toBe("email");
  });

  it("uses sendApproved on screening_passed", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ email: "dana@example.com", first_name: "Dana", phone: "+17025551234" }] });
    mockApproved.mockResolvedValueOnce({ sent: true });
    await notifyPersonStep({ applicationId: APP, toStatus: "screening_passed", trigger: "all_checks_passed" });
    expect(mockApproved).toHaveBeenCalledTimes(1);
    expect(mockStatusUpdate).not.toHaveBeenCalled();
    expect(mockLedger.mock.calls[0][0].eventType).toBe("screening_passed");
  });

  it("skips the email for a non-deliverable (voice-handoff) address but still ledgers", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ email: "voice+x@voice-handoff.invalid", first_name: "Dana", phone: "+17025551234" }] });
    await notifyPersonStep({ applicationId: APP, toStatus: "screening", trigger: "screening_started" });
    expect(mockStatusUpdate).not.toHaveBeenCalled();
    expect(mockLedger.mock.calls[0][0].channel).toBe("system"); // recorded as internal, not emailed
  });

  it("never throws on a DB error", async () => {
    mockQuery.mockRejectedValueOnce(new Error("boom"));
    await expect(notifyPersonStep({ applicationId: APP, toStatus: "screening", trigger: "screening_started" })).resolves.toBeUndefined();
  });
});
