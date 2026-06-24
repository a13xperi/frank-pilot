/**
 * Tests for the application-requirements checklist — the deterministic "what's
 * still missing" that drives Frank's document-chase callbacks and inbound
 * resume. Exercised through the real service/tool with a mocked DB.
 *
 * The headline case is Craig: photo ID verified + SSN on file + consent given,
 * but pay stubs not yet → missing = [income_paystubs], so the callback asks for
 * exactly that. Marking it auto-closes the open document-chase follow-up.
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

import { computeMissing, markItem } from "../modules/requirements/service";
import {
  markRequirementHandler,
  registerRequirementHandlers,
  __resetRegistrationForTests,
} from "../modules/requirements/tools";
import {
  clearToolHandlersForTests,
  getRegisteredToolNames,
} from "../modules/voice-intake/tool-callbacks";

const CTX = { agentId: "a", conversationId: "conv_REQ", toolCallId: "tc", toolName: "mark_requirement" as const };
const PHONE = "+17025551234";

// Craig: ID verified, SSN on file, consent given — only pay stubs outstanding.
const CRAIG_ROW = {
  id: "app1",
  status: "draft",
  has_ssn: true,
  identity_verification_result: "pass",
  identity_session_status: "verified",
  income_verified: false,
  income_verification_result: null,
  screening_authorization_at: "2026-06-24T00:00:00Z",
};
// Everything satisfied (used for the auto-close case).
const COMPLETE_ROW = {
  ...CRAIG_ROW,
  income_verified: true,
  income_verification_result: "pass",
};

beforeEach(() => jest.clearAllMocks());

describe("computeMissing", () => {
  it("Craig: only pay stubs outstanding (column-derived, no overrides)", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [CRAIG_ROW] }) // SIGNAL_SELECT
      .mockResolvedValueOnce({ rows: [] }); // overrides
    const missing = await computeMissing("app1");
    expect(missing.map((m) => m.key)).toEqual(["income_paystubs"]);
    expect(missing[0].label).toContain("pay stubs");
  });

  it("an explicit received override clears the gap", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [CRAIG_ROW] })
      .mockResolvedValueOnce({ rows: [{ item_key: "income_paystubs", status: "received" }] });
    const missing = await computeMissing("app1");
    expect(missing).toEqual([]);
  });

  it("returns [] for an unknown application id", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // SIGNAL_SELECT empty
    expect(await computeMissing("nope")).toEqual([]);
  });
});

describe("markItem auto-close", () => {
  it("closes the open needs_info follow-up once nothing required remains", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // INSERT upsert
      .mockResolvedValueOnce({ rows: [COMPLETE_ROW] }) // resolve→computeMissing SIGNAL
      .mockResolvedValueOnce({ rows: [] }) // resolve→computeMissing overrides → missing []
      .mockResolvedValueOnce({ rows: [{ phone: PHONE }] }) // SELECT phone
      .mockResolvedValueOnce({ rows: [{ id: "fu-1" }] }); // UPDATE follow_ups RETURNING
    const ok = await markItem({ applicationId: "app1", itemKey: "income_paystubs", status: "verified" });
    expect(ok).toBe(true);
    const updateSql = mockQuery.mock.calls[4][0] as string;
    expect(updateSql).toContain("UPDATE follow_ups");
    expect(updateSql).toContain("status = 'completed'");
    expect(updateSql).toContain("reason = 'needs_info'");
  });

  it("rejects an unknown item_key without touching the DB", async () => {
    const ok = await markItem({ applicationId: "app1", itemKey: "bogus", status: "received" });
    expect(ok).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe("mark_requirement tool", () => {
  it("ok:false with no phone", async () => {
    const r = await markRequirementHandler({ item_key: "income_paystubs" }, CTX);
    expect(r.ok).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("ok:false (with valid_items) on an unknown item", async () => {
    const r = await markRequirementHandler({ phone_e164: PHONE, item_key: "nope" }, CTX);
    expect(r.ok).toBe(false);
    expect((r.result?.valid_items as string[])).toContain("income_paystubs");
  });

  it("ok:false when no application exists on the number", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // markItemByPhone app lookup
    const r = await markRequirementHandler({ phone_e164: PHONE, item_key: "income_paystubs" }, CTX);
    expect(r.ok).toBe(false);
  });

  it("marks the item and reports what's still left", async () => {
    const noConsent = { ...CRAIG_ROW, screening_authorization_at: null };
    const override = [{ item_key: "income_paystubs", status: "received" }];
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: "app1" }] }) // markItemByPhone app lookup
      .mockResolvedValueOnce({ rows: [] }) // markItem INSERT
      .mockResolvedValueOnce({ rows: [noConsent] }) // resolve→computeMissing SIGNAL
      .mockResolvedValueOnce({ rows: override }) // resolve→computeMissing overrides (consent still missing → early return)
      .mockResolvedValueOnce({ rows: [{ id: "app1" }] }) // computeMissingByPhone app lookup
      .mockResolvedValueOnce({ rows: [noConsent] }) // computeMissingByPhone→computeMissing SIGNAL
      .mockResolvedValueOnce({ rows: override }); // computeMissingByPhone→computeMissing overrides
    const r = await markRequirementHandler(
      { phone_e164: PHONE, item_key: "income_paystubs", status: "received" },
      CTX
    );
    expect(r.ok).toBe(true);
    expect(r.result?.remaining).toEqual(["consent_screening"]);
    expect(r.message).toContain("background and credit");
  });
});

describe("registration", () => {
  it("registers mark_requirement", () => {
    clearToolHandlersForTests();
    __resetRegistrationForTests();
    registerRequirementHandlers();
    expect(getRegisteredToolNames()).toEqual(expect.arrayContaining(["mark_requirement"]));
  });
});
