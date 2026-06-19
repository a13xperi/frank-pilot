/**
 * B2 — RecertificationService.processReminders() dispatches through a pluggable
 * notifier (no real Twilio). A mock Notifier is injected; we assert the reminder
 * state machine routes the right message to it for a due recert, and that a
 * notifier throw can never break processing (fire-and-forget).
 */
import type { QueryResult } from "pg";
import { RecertificationService } from "../modules/recertification/service";
import { query } from "../config/database";
import { writeAuditLog } from "../middleware/audit";
import type { Notifier } from "../modules/recertification/notifier";

function qr<T extends Record<string, unknown>>(rows: T[]): QueryResult<T> {
  return { rows, rowCount: rows.length } as unknown as QueryResult<T>;
}

jest.mock("../config/database", () => ({ query: jest.fn() }));
jest.mock("../middleware/audit", () => ({ writeAuditLog: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
// The compliance check + tape are out of scope here; stub the service it news up.
jest.mock("../modules/acquisitions/recert-compliance", () => ({
  RecertComplianceService: jest.fn().mockImplementation(() => ({
    check: jest.fn().mockResolvedValue(null),
  })),
}));
// Default TwilioNotifier must never construct a real Twilio client in these tests
// (we always inject a mock notifier), but guard anyway.
jest.mock("../modules/integrations/twilio", () => ({
  TwilioService: jest.fn(() => ({ sendSMS: jest.fn() })),
}));

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockAudit = writeAuditLog as jest.MockedFunction<typeof writeAuditLog>;

function makeNotifier(notifyImpl?: Notifier["notify"]) {
  const notify = jest.fn(notifyImpl ?? (async () => undefined));
  const notifier: Notifier = { channels: () => ["sms"], notify };
  return { notifier, notify };
}

/** A recert row ~119 days out so only the 120-day reminder is due. */
function dueRecertRow(overrides: Record<string, unknown> = {}) {
  const anniv = new Date();
  anniv.setDate(anniv.getDate() + 119);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + 89); // cutoff still in the future → not overdue
  return {
    id: "recert-1",
    application_id: "app-1",
    property_id: "prop-1",
    tenant_name: "Jane Doe",
    status: "pending",
    anniversary_date: anniv.toISOString(),
    cutoff_date: cutoff.toISOString(),
    reminder_120_sent_at: null,
    reminder_90_sent_at: null,
    reminder_60_sent_at: null,
    phone: "+17025550101",
    first_name: "Jane",
    last_name: "Doe",
    ...overrides,
  };
}

describe("processReminders dispatch via notifier", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockAudit.mockReset().mockResolvedValue(undefined);
  });

  it("routes a due 120-day reminder to the injected notifier (no Twilio)", async () => {
    const { notifier, notify } = makeNotifier();
    const svc = new RecertificationService({ notifier });

    // 1st query = the SELECT of due recerts; subsequent = UPDATEs (return empty ok).
    mockQuery.mockResolvedValueOnce(qr([dueRecertRow()]));
    mockQuery.mockResolvedValue(qr([]));

    const stats = await svc.processReminders();

    expect(notify).toHaveBeenCalledTimes(1);
    const arg = notify.mock.calls[0][0];
    expect(arg.phone).toBe("+17025550101");
    expect(arg.message).toContain("Jane Doe");
    expect(arg.message).toContain("recertification");
    expect(stats.reminded).toBe(1);
  });

  it("does not notify when the recert has no phone", async () => {
    const { notifier, notify } = makeNotifier();
    const svc = new RecertificationService({ notifier });
    mockQuery.mockResolvedValueOnce(qr([dueRecertRow({ phone: null })]));
    mockQuery.mockResolvedValue(qr([]));

    await svc.processReminders();
    expect(notify).not.toHaveBeenCalled();
  });

  it("a notifier throw does not break processing (fire-and-forget)", async () => {
    const { notifier } = makeNotifier(async () => { throw new Error("notify boom"); });
    const svc = new RecertificationService({ notifier });
    mockQuery.mockResolvedValueOnce(qr([dueRecertRow()]));
    mockQuery.mockResolvedValue(qr([]));

    // Must resolve, not reject. (notify is fire-and-forget via `void`.)
    const stats = await svc.processReminders();
    expect(stats.reminded).toBe(1);
  });

  it("defaults to a TwilioNotifier when none is injected (constructs cleanly)", () => {
    const svc = new RecertificationService();
    expect(svc).toBeInstanceOf(RecertificationService);
  });
});
