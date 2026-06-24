/**
 * Tests for the relationship ledger (the "ledger of truth") — record + read +
 * the get_ledger voice tool.
 */

const mockQuery = jest.fn();
jest.mock("../config/database", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../modules/voice-intake/service", () => ({
  normalizePhone: (p: unknown) => (typeof p === "string" && p.trim() ? p.trim() : null),
}));

import { recordLedgerEntry, getLedgerByPhone } from "../modules/relationship/ledger";
import {
  getLedgerHandler,
  registerRelationshipHandlers,
  __resetRegistrationForTests,
} from "../modules/relationship/tools";
import {
  clearToolHandlersForTests,
  getRegisteredToolNames,
} from "../modules/voice-intake/tool-callbacks";

const CTX = { agentId: "a", conversationId: "conv_L", toolCallId: "tc", toolName: "get_ledger" as const };
const PHONE = "+17025551234";

beforeEach(() => jest.clearAllMocks());

describe("recordLedgerEntry", () => {
  it("writes an append-only entry", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await recordLedgerEntry({ phoneE164: PHONE, eventType: "fee_paid", summary: "Paid the fee" });
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("INSERT INTO relationship_ledger");
    expect(mockQuery.mock.calls[0][1]).toContain("fee_paid");
  });
  it("never throws on a bad phone (no write)", async () => {
    await expect(recordLedgerEntry({ phoneE164: null, eventType: "x" })).resolves.toBeUndefined();
    expect(mockQuery).not.toHaveBeenCalled();
  });
  it("never throws on a DB error", async () => {
    mockQuery.mockRejectedValueOnce(new Error("boom"));
    await expect(recordLedgerEntry({ phoneE164: PHONE, eventType: "x" })).resolves.toBeUndefined();
  });
});

describe("get_ledger", () => {
  it("ok:false without a phone", async () => {
    const r = await getLedgerHandler({}, CTX);
    expect(r.ok).toBe(false);
  });
  it("recounts the journey oldest-first", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { event_type: "fee_paid", channel: "system", direction: "internal", summary: "Paid the $35.95 fee", occurred_at: new Date("2026-06-24T02:00:00Z") },
        { event_type: "application_created", channel: "system", direction: "internal", summary: "Application started", occurred_at: new Date("2026-06-24T01:00:00Z") },
      ],
    });
    const r = await getLedgerHandler({ phone_e164: PHONE }, CTX);
    expect(r.ok).toBe(true);
    // oldest-first in the spoken recap
    expect(r.message).toBe("Here's everything so far: Application started; Paid the $35.95 fee.");
  });
  it("handles an empty history", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const r = await getLedgerHandler({ phone_e164: PHONE }, CTX);
    expect(r.ok).toBe(true);
    expect(r.message).toContain("don't have any history");
  });
  it("registers get_ledger", () => {
    clearToolHandlersForTests();
    __resetRegistrationForTests();
    registerRelationshipHandlers();
    expect(getRegisteredToolNames()).toContain("get_ledger");
  });
});
