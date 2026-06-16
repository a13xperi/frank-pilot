/**
 * Tests for the Phase 2 concierge co-browse SCAFFOLD (DARK).
 *
 * Scope (no browser, no live loop — the orchestrator is a stub):
 *   - start_cobrowse fail-closed: denies when COBROWSE_ENABLED is off
 *   - start_cobrowse fail-closed: denies when cobrowse_consent is absent
 *   - buildFieldPlan: pure ordering + selectors + required-ness + prefill map
 *   - confirm_cobrowse: sets confirmed_at / state='confirmed' on the row
 *
 * We mock the DB, logger, tape, and SMS transport so the suite exercises the
 * handler business logic in isolation (mirrors voice-send-app-link.test.ts).
 */

const mockQuery = jest.fn();
jest.mock("../config/database", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockStampTape = jest.fn().mockResolvedValue(null);
jest.mock("../modules/tape", () => ({
  stampTape: (...args: unknown[]) => mockStampTape(...args),
}));

const mockSendMagicLinkSms = jest.fn();
jest.mock("../modules/auth/magic-link-service", () => ({
  sendMagicLinkSms: (...args: unknown[]) => mockSendMagicLinkSms(...args),
}));

import { startCobrowseHandler } from "../modules/cobrowse/start-cobrowse";
import { confirmCobrowseHandler } from "../modules/cobrowse/confirm-cobrowse";
import { buildFieldPlan } from "../modules/cobrowse/runtime/field-plan";

const CTX = {
  agentId: "agent_test",
  conversationId: "conv_COBROWSE_1",
  toolCallId: "tc_cb_1",
  toolName: "start_cobrowse" as const,
};

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe("startCobrowseHandler — fail closed", () => {
  it("denies when COBROWSE_ENABLED is not 'true'", async () => {
    delete process.env.COBROWSE_ENABLED;

    const result = await startCobrowseHandler({ cobrowse_consent: true }, CTX);

    expect(result.ok).toBe(false);
    // No DB writes, no SMS when the feature is dark.
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockSendMagicLinkSms).not.toHaveBeenCalled();
    // Deny is audited.
    const denyStamp = mockStampTape.mock.calls.find(
      (c) => (c[0] as { kind?: string })?.kind === "COBROWSE_DENIED"
    );
    expect(denyStamp).toBeDefined();
  });

  it("denies when consent is absent even with the flag on", async () => {
    process.env.COBROWSE_ENABLED = "true";

    const result = await startCobrowseHandler({}, CTX);

    expect(result.ok).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockSendMagicLinkSms).not.toHaveBeenCalled();
    const denyStamp = mockStampTape.mock.calls.find(
      (c) => (c[0] as { kind?: string })?.kind === "COBROWSE_DENIED"
    );
    expect(denyStamp).toBeDefined();
  });

  it("creates a session + texts the viewer link on the happy path", async () => {
    process.env.COBROWSE_ENABLED = "true";
    mockQuery
      // findOrCreateDraft: explicit application_id lookup
      .mockResolvedValueOnce({ rows: [{ id: "app-1", user_id: "user-1" }] })
      // INSERT cobrowse_sessions
      .mockResolvedValueOnce({ rows: [{ id: "sess-1" }] });

    const result = await startCobrowseHandler(
      { cobrowse_consent: true, application_id: "app-1" },
      CTX
    );

    expect(result.ok).toBe(true);
    expect(result.result).toEqual({ sessionId: "sess-1" });
    // viewer link SMS'd to the resolved user id.
    expect(mockSendMagicLinkSms).toHaveBeenCalledTimes(1);
    expect(mockSendMagicLinkSms.mock.calls[0][0]).toBe("user-1");
    expect(mockSendMagicLinkSms.mock.calls[0][1]).toMatch(/\/cobrowse\/sess-1\?vt=/);
    // Consent + session-started stamps fired.
    const kinds = mockStampTape.mock.calls.map(
      (c) => (c[0] as { kind?: string })?.kind
    );
    expect(kinds).toContain("COBROWSE_CONSENT_CAPTURED");
    expect(kinds).toContain("COBROWSE_SESSION_STARTED");
  });
});

describe("buildFieldPlan — pure ordering", () => {
  it("returns the steps in wizard order with the right selectors", () => {
    const plan = buildFieldPlan({});
    expect(plan.map((s) => s.stepKey)).toEqual([
      "ssn",
      "dob",
      "address",
      "city",
      "state",
      "zip",
      "employer",
      "income",
      "household",
      "moveIn",
    ]);
    expect(plan.map((s) => s.selector)).toEqual([
      "#ssn",
      "#dob",
      "#address",
      "#city",
      "#state",
      "#zip",
      "#employer",
      "#income",
      "#household",
      "#moveIn",
    ]);
  });

  it("marks ssn / dob / household required and the rest optional", () => {
    const plan = buildFieldPlan({});
    const required = plan.filter((s) => s.required).map((s) => s.stepKey);
    expect(required.sort()).toEqual(["dob", "household", "ssn"]);
  });

  it("maps prefill values (incl. numbers) and nulls the rest", () => {
    const plan = buildFieldPlan({
      city: "Las Vegas",
      annualIncome: 42000,
      householdSize: 3,
      state: "  NV  ",
    });
    const byKey = Object.fromEntries(plan.map((s) => [s.stepKey, s.value]));
    expect(byKey.city).toBe("Las Vegas");
    expect(byKey.income).toBe("42000");
    expect(byKey.household).toBe("3");
    expect(byKey.state).toBe("NV"); // trimmed
    expect(byKey.ssn).toBeNull();
    expect(byKey.employer).toBeNull();
  });

  it("is null-safe on missing prefill", () => {
    const plan = buildFieldPlan(null);
    expect(plan).toHaveLength(10);
    expect(plan.every((s) => s.value === null)).toBe(true);
  });
});

describe("confirmCobrowseHandler", () => {
  const CONFIRM_CTX = { ...CTX, toolName: "confirm_cobrowse" as const };

  it("denies when the feature is dark", async () => {
    delete process.env.COBROWSE_ENABLED;
    const result = await confirmCobrowseHandler({ session_id: "sess-1" }, CONFIRM_CTX);
    expect(result.ok).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("sets confirmed_at + state='confirmed' and stamps COBROWSE_CONFIRMED", async () => {
    process.env.COBROWSE_ENABLED = "true";
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "sess-1" }] });

    const result = await confirmCobrowseHandler({ session_id: "sess-1" }, CONFIRM_CTX);

    expect(result.ok).toBe(true);
    expect(result.result).toEqual({ sessionId: "sess-1", confirmed: true });
    // The UPDATE sets state='confirmed' + confirmed_at.
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toMatch(/UPDATE cobrowse_sessions/);
    expect(sql).toMatch(/state = 'confirmed'/);
    expect(sql).toMatch(/confirmed_at = NOW\(\)/);
    const kinds = mockStampTape.mock.calls.map(
      (c) => (c[0] as { kind?: string })?.kind
    );
    expect(kinds).toContain("COBROWSE_CONFIRMED");
  });

  it("returns ok:false when no active session matches", async () => {
    process.env.COBROWSE_ENABLED = "true";
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await confirmCobrowseHandler({ session_id: "nope" }, CONFIRM_CTX);

    expect(result.ok).toBe(false);
  });

  it("returns ok:false when session_id is missing", async () => {
    process.env.COBROWSE_ENABLED = "true";

    const result = await confirmCobrowseHandler({}, CONFIRM_CTX);

    expect(result.ok).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
