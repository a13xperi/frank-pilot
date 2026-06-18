/**
 * Tests for the Tier 1 "guided co-pilot" co-browse (the SAFE, no-computer-use
 * lane). Scope:
 *   - coaching map is pure + ordered + covers the field-plan steps
 *   - composeGuidedStatus shapes the cobrowse_status payload + advances "next"
 *   - recordGuidedStep fail-closed behind COBROWSE_GUIDED_ENABLED + token-gated
 *   - recordGuidedStep happy path stamps guided audit kinds, rejects bad steps
 *   - cobrowseStatusHandler fail-closed + reads back the coaching for the step
 *
 * DB / logger / tape are mocked (mirrors cobrowse.test.ts) so we exercise the
 * handler logic without a live browser, call, or Postgres.
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

import crypto from "crypto";
import {
  coachingFor,
  nextStepKey,
  isGuidedStep,
  composeGuidedStatus,
  GUIDED_STEP_ORDER,
} from "../modules/cobrowse/runtime/coaching";
import { buildFieldPlan } from "../modules/cobrowse/runtime/field-plan";
import {
  recordGuidedStep,
  cobrowseStatusHandler,
  guidedEnabled,
} from "../modules/cobrowse/guided";

const CTX = {
  agentId: "agent_test",
  conversationId: "conv_GUIDED_1",
  toolCallId: "tc_guided_1",
  toolName: "cobrowse_status" as const,
};

const RAW_TOKEN = "raw-viewer-token-abc";
const TOKEN_HASH = crypto.createHash("sha256").update(RAW_TOKEN).digest("hex");
const FUTURE = new Date(Date.now() + 10 * 60 * 1000).toISOString();
const PAST = new Date(Date.now() - 60 * 1000).toISOString();

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe("coaching map — pure", () => {
  it("covers every field-plan step key", () => {
    const planKeys = buildFieldPlan({}).map((s) => s.stepKey);
    for (const key of planKeys) {
      expect(isGuidedStep(key)).toBe(true);
      expect(coachingFor(key)?.coaching).toBeTruthy();
    }
  });

  it("marks the binding/sensitive steps as applicantMustDo", () => {
    for (const key of ["verify_email", "ssn", "dob", "identity", "consent", "sign", "pay", "submit"]) {
      expect(coachingFor(key)?.applicantMustDo).toBe(true);
    }
    // Prefillable facts are NOT applicant-must-do.
    for (const key of ["city", "employer", "income", "household"]) {
      expect(coachingFor(key)?.applicantMustDo).toBe(false);
    }
  });

  it("gives concrete pay-stub guidance on the documents step", () => {
    const text = coachingFor("documents")?.coaching ?? "";
    expect(text.toLowerCase()).toContain("pay stub");
  });

  it("walks next in the declared order and ends at submit", () => {
    expect(nextStepKey(null)).toBe(GUIDED_STEP_ORDER[0]);
    expect(nextStepKey("income")).toBe("documents");
    expect(nextStepKey("submit")).toBeNull();
    expect(coachingFor("not-a-real-step")).toBeNull();
  });
});

describe("composeGuidedStatus", () => {
  it("shapes the cobrowse_status payload with current + next", () => {
    const s = composeGuidedStatus("viewer_connected", "income");
    expect(s.currentStep).toBe("income");
    expect(s.currentLabel).toMatch(/income/i);
    expect(s.coaching).toBeTruthy();
    expect(s.nextStep).toBe("documents");
    expect(s.done).toBe(false);
  });

  it("flags done at submit and handles no-step-yet", () => {
    expect(composeGuidedStatus("created", null).currentStep).toBeNull();
    expect(composeGuidedStatus("driving", "submit").done).toBe(true);
  });
});

describe("recordGuidedStep — fail closed + token gated", () => {
  it("denies (503) when COBROWSE_GUIDED_ENABLED is off", async () => {
    delete process.env.COBROWSE_GUIDED_ENABLED;
    const r = await recordGuidedStep({ sessionId: "s1", rawToken: RAW_TOKEN, stepKey: "income" });
    expect(r).toEqual({ ok: false, code: 503, error: "cobrowse_guided_disabled" });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("400s on a missing token or an unknown step", async () => {
    process.env.COBROWSE_GUIDED_ENABLED = "true";
    expect(await recordGuidedStep({ sessionId: "s1", rawToken: null, stepKey: "income" }))
      .toMatchObject({ ok: false, code: 400, error: "missing_token" });
    expect(await recordGuidedStep({ sessionId: "s1", rawToken: RAW_TOKEN, stepKey: "bogus" }))
      .toMatchObject({ ok: false, code: 400, error: "unknown_step" });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("404s on a token/session mismatch", async () => {
    process.env.COBROWSE_GUIDED_ENABLED = "true";
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const r = await recordGuidedStep({ sessionId: "s1", rawToken: RAW_TOKEN, stepKey: "income" });
    expect(r).toMatchObject({ ok: false, code: 404 });
  });

  it("410s on an expired session", async () => {
    process.env.COBROWSE_GUIDED_ENABLED = "true";
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: "s1", state: "viewer_connected", expires_at: PAST, guided_started_at: null }],
    });
    const r = await recordGuidedStep({ sessionId: "s1", rawToken: RAW_TOKEN, stepKey: "income" });
    expect(r).toMatchObject({ ok: false, code: 410, error: "expired" });
  });

  it("records the step + stamps guided audit kinds on the first report", async () => {
    process.env.COBROWSE_GUIDED_ENABLED = "true";
    mockQuery
      // lookup
      .mockResolvedValueOnce({
        rows: [{ id: "s1", state: "viewer_connected", expires_at: FUTURE, guided_started_at: null }],
      })
      // update
      .mockResolvedValueOnce({
        rows: [{ state: "viewer_connected", current_step: "income", steps_reached: 1 }],
      });

    const r = await recordGuidedStep({ sessionId: "s1", rawToken: RAW_TOKEN, stepKey: "income" });
    expect(r).toMatchObject({ ok: true, currentStep: "income", stepsReached: 1 });

    // The lookup matched on the sha256 of the raw token (never the raw token).
    const lookupArgs = mockQuery.mock.calls[0][1] as string[];
    expect(lookupArgs).toContain(TOKEN_HASH);
    expect(lookupArgs).not.toContain(RAW_TOKEN);

    const kinds = mockStampTape.mock.calls.map((c) => (c[0] as { kind?: string })?.kind);
    expect(kinds).toContain("COBROWSE_GUIDED_STARTED");
    expect(kinds).toContain("COBROWSE_STEP_REACHED");
  });

  it("does NOT re-stamp GUIDED_STARTED on a later step report", async () => {
    process.env.COBROWSE_GUIDED_ENABLED = "true";
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: "s1", state: "viewer_connected", expires_at: FUTURE, guided_started_at: new Date().toISOString() }],
      })
      .mockResolvedValueOnce({
        rows: [{ state: "viewer_connected", current_step: "documents", steps_reached: 5 }],
      });

    await recordGuidedStep({ sessionId: "s1", rawToken: RAW_TOKEN, stepKey: "documents" });
    const kinds = mockStampTape.mock.calls.map((c) => (c[0] as { kind?: string })?.kind);
    expect(kinds).toContain("COBROWSE_STEP_REACHED");
    expect(kinds).not.toContain("COBROWSE_GUIDED_STARTED");
  });
});

describe("cobrowseStatusHandler — voice tool", () => {
  it("guidedEnabled reflects the flag", () => {
    delete process.env.COBROWSE_GUIDED_ENABLED;
    expect(guidedEnabled()).toBe(false);
    process.env.COBROWSE_GUIDED_ENABLED = "true";
    expect(guidedEnabled()).toBe(true);
  });

  it("denies when guided is off", async () => {
    delete process.env.COBROWSE_GUIDED_ENABLED;
    const r = await cobrowseStatusHandler({ session_id: "s1" }, CTX);
    expect(r.ok).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("reads back the coaching for the applicant's current step", async () => {
    process.env.COBROWSE_GUIDED_ENABLED = "true";
    mockQuery.mockResolvedValueOnce({ rows: [{ state: "viewer_connected", current_step: "documents" }] });

    const r = await cobrowseStatusHandler({ session_id: "s1" }, CTX);
    expect(r.ok).toBe(true);
    expect((r.result as { currentStep?: string }).currentStep).toBe("documents");
    expect((r.message ?? "").toLowerCase()).toContain("pay stub");
  });

  it("guides to open the link when no step has been reported yet", async () => {
    process.env.COBROWSE_GUIDED_ENABLED = "true";
    mockQuery.mockResolvedValueOnce({ rows: [{ state: "created", current_step: null }] });
    const r = await cobrowseStatusHandler({ session_id: "s1" }, CTX);
    expect(r.ok).toBe(true);
    expect((r.message ?? "").toLowerCase()).toContain("link");
  });

  it("handles an unknown session id", async () => {
    process.env.COBROWSE_GUIDED_ENABLED = "true";
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const r = await cobrowseStatusHandler({ session_id: "nope" }, CTX);
    expect(r.ok).toBe(false);
  });
});
