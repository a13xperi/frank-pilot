/**
 * Dialer gate-chain tests for src/modules/outbound-validation/dialer.ts.
 *
 * Everything is hermetic: the local Postgres goes through the mockQuery
 * SQL-shape router, the Sage client is fully mocked, and the ElevenLabs
 * outbound call is a mocked global fetch. System time is pinned inside the
 * Pacific call window so the window gate doesn't flake by wall clock.
 */

const mockQuery = jest.fn();
jest.mock("../config/database", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockClaimNextCall = jest.fn();
const mockRecordCallOutcome = jest.fn();
const mockResetClaim = jest.fn();
jest.mock("../modules/outbound-validation/sage-client", () => ({
  claimNextCall: (...args: unknown[]) => mockClaimNextCall(...args),
  recordCallOutcome: (...args: unknown[]) => mockRecordCallOutcome(...args),
  resetClaim: (...args: unknown[]) => mockResetClaim(...args),
}));

const mockStampTape = jest.fn().mockResolvedValue(null);
jest.mock("../modules/tape", () => ({
  stampTape: (...args: unknown[]) => mockStampTape(...args),
}));

import {
  runDialerTick,
  sweepStuckCalls,
  isWithinCallWindow,
  buildDynamicVariables,
} from "../modules/outbound-validation/dialer";
import { logger } from "../utils/logger";
import type { SageApplicant } from "../modules/outbound-validation/sage-client";

const APPLICANT: SageApplicant = {
  id: "11111111-1111-1111-1111-111111111111",
  full_name: "Jane Doe",
  phone_e164: "+17025551234",
  phone_display: "(702) 555-1234",
  phone_shared_with: null,
  properties: ["donna-louise-1", "donna-louise-2"],
  first_added: "2026-05-01T12:00:00Z",
  date_needed: "2026-06-30",
  asap: false,
  apt_types: ["1br", "2br"],
  call_status: "in_progress",
  call_attempts: 0,
  still_interested: null,
  last_call_at: null,
  call_notes: null,
};

interface DbState {
  inFlight: boolean;
  dialsToday: number;
  minsSinceLast: number | null;
}

const inserts: Array<{ sql: string; params: unknown[] }> = [];

function routeQueries(state: DbState): void {
  mockQuery.mockImplementation((sql: string, params: unknown[]) => {
    if (sql.includes("status = 'dialed'") && sql.includes("LIMIT 1")) {
      return Promise.resolve({ rows: state.inFlight ? [{ "?column?": 1 }] : [] });
    }
    if (sql.includes("COUNT(*)")) {
      return Promise.resolve({ rows: [{ count: state.dialsToday }] });
    }
    if (sql.includes("EXTRACT(EPOCH")) {
      return Promise.resolve({ rows: [{ mins: state.minsSinceLast }] });
    }
    if (sql.includes("INSERT INTO outbound_validation_calls")) {
      inserts.push({ sql, params: params as unknown[] });
      return Promise.resolve({ rows: [] });
    }
    return Promise.resolve({ rows: [] });
  });
}

const ENV_KEYS = [
  "FRANK_OUTBOUND_ENABLED",
  "FRANK_OUTBOUND_DRY_RUN",
  "FRANK_OUTBOUND_TEST_NUMBER",
  "FRANK_OUTBOUND_BATCH_LIMIT",
  "FRANK_OUTBOUND_PACE_MINUTES",
  "ELEVENLABS_API_KEY",
  "ELEVENLABS_OUTBOUND_AGENT_ID",
  "ELEVENLABS_AGENT_PHONE_NUMBER_ID",
];
const savedEnv: Record<string, string | undefined> = {};

beforeAll(() => {
  jest.useFakeTimers();
  // Noon PDT on a June weekday — squarely inside the 9am–8pm window.
  jest.setSystemTime(new Date("2026-06-11T19:00:00Z"));
});

afterAll(() => {
  jest.useRealTimers();
});

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.FRANK_OUTBOUND_ENABLED = "true";
  process.env.FRANK_OUTBOUND_DRY_RUN = "false";
  process.env.FRANK_OUTBOUND_TEST_NUMBER = "";
  process.env.FRANK_OUTBOUND_BATCH_LIMIT = "5";
  process.env.FRANK_OUTBOUND_PACE_MINUTES = "5";
  process.env.ELEVENLABS_API_KEY = "xi-test";
  process.env.ELEVENLABS_OUTBOUND_AGENT_ID = "agent_outbound_test_123";
  process.env.ELEVENLABS_AGENT_PHONE_NUMBER_ID = "phnum_test_123";
  inserts.length = 0;
  mockQuery.mockReset();
  mockClaimNextCall.mockReset();
  mockRecordCallOutcome.mockReset().mockResolvedValue(undefined);
  mockResetClaim.mockReset().mockResolvedValue(undefined);
  mockStampTape.mockClear();
  (logger.info as jest.Mock).mockClear();
  (logger.warn as jest.Mock).mockClear();
  (logger.error as jest.Mock).mockClear();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  delete (global as { fetch?: unknown }).fetch;
});

function stubFetch(response: { ok: boolean; status?: number; body?: unknown }): jest.Mock {
  const fn = jest.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 500),
    json: async () => response.body ?? {},
    text: async () => JSON.stringify(response.body ?? {}),
  });
  (global as { fetch?: unknown }).fetch = fn;
  return fn;
}

describe("isWithinCallWindow (America/Los_Angeles, DST-aware)", () => {
  it.each([
    ["2026-01-15T17:00:00Z", true, "9:00am PST"],
    ["2026-01-15T16:59:00Z", false, "8:59am PST"],
    ["2026-01-16T03:59:00Z", true, "7:59pm PST"],
    ["2026-01-16T04:00:00Z", false, "8:00pm PST"],
    ["2026-07-15T16:00:00Z", true, "9:00am PDT"],
    ["2026-07-15T15:59:00Z", false, "8:59am PDT"],
    ["2026-07-16T02:59:00Z", true, "7:59pm PDT"],
    ["2026-07-16T03:00:00Z", false, "8:00pm PDT"],
  ])("%s -> %s (%s)", (iso, expected) => {
    expect(isWithinCallWindow(new Date(iso as string))).toBe(expected);
  });
});

describe("buildDynamicVariables", () => {
  it("humanizes properties, apartment types, and dates", () => {
    const vars = buildDynamicVariables(APPLICANT);
    expect(vars).toEqual({
      applicant_id: APPLICANT.id,
      applicant_name: "Jane Doe",
      property_names: "Donna Louise 1 and Donna Louise 2",
      apt_types: "1 bedroom, 2 bedroom",
      date_needed: "2026-06-30",
      shared_with: "",
    });
  });

  it("ASAP overrides the date and studio stays studio", () => {
    const vars = buildDynamicVariables({
      ...APPLICANT,
      asap: true,
      apt_types: ["studio"],
      phone_shared_with: "John Doe",
      properties: ["donna-louise-1"],
    });
    expect(vars.date_needed).toBe("as soon as possible");
    expect(vars.apt_types).toBe("studio");
    expect(vars.shared_with).toBe("John Doe");
    expect(vars.property_names).toBe("Donna Louise 1");
  });
});

describe("runDialerTick gate chain", () => {
  it("short-circuits when the master flag is off", async () => {
    process.env.FRANK_OUTBOUND_ENABLED = "false";
    expect(await runDialerTick()).toEqual({ action: "disabled" });
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockClaimNextCall).not.toHaveBeenCalled();
  });

  it("refuses to dial while a call is in flight", async () => {
    routeQueries({ inFlight: true, dialsToday: 0, minsSinceLast: null });
    expect((await runDialerTick()).action).toBe("in_flight");
    expect(mockClaimNextCall).not.toHaveBeenCalled();
  });

  it("stops at the daily batch limit", async () => {
    routeQueries({ inFlight: false, dialsToday: 5, minsSinceLast: 60 });
    const result = await runDialerTick();
    expect(result.action).toBe("batch_limit");
    expect(mockClaimNextCall).not.toHaveBeenCalled();
  });

  it("paces between dials", async () => {
    routeQueries({ inFlight: false, dialsToday: 1, minsSinceLast: 2 });
    expect((await runDialerTick()).action).toBe("paced");
    expect(mockClaimNextCall).not.toHaveBeenCalled();
  });

  it("reports an empty queue", async () => {
    routeQueries({ inFlight: false, dialsToday: 0, minsSinceLast: null });
    mockClaimNextCall.mockResolvedValue(null);
    expect((await runDialerTick()).action).toBe("queue_empty");
  });

  it("DRY_RUN logs, records a dry_run row, resets the claim, and never dials", async () => {
    process.env.FRANK_OUTBOUND_DRY_RUN = "true";
    const fetchMock = stubFetch({ ok: true });
    routeQueries({ inFlight: false, dialsToday: 0, minsSinceLast: null });
    mockClaimNextCall.mockResolvedValue(APPLICANT);

    const result = await runDialerTick();
    expect(result.action).toBe("dry_run");
    expect(result.applicantId).toBe(APPLICANT.id);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockResetClaim).toHaveBeenCalledWith(APPLICANT.id);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].sql).toContain("'dry_run'");
    // TCPA tape anchor: dry runs stamp the attempt too.
    expect(mockStampTape).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "VOICE_INTAKE_OUTBOUND_ATTEMPTED",
        payload: expect.objectContaining({ applicantId: APPLICANT.id, dryRun: true }),
      })
    );
  });

  it("dials through ElevenLabs and tracks the conversation", async () => {
    const fetchMock = stubFetch({
      ok: true,
      body: { conversation_id: "conv_abc", callSid: "CA123" },
    });
    routeQueries({ inFlight: false, dialsToday: 0, minsSinceLast: 10 });
    mockClaimNextCall.mockResolvedValue(APPLICANT);

    const result = await runDialerTick({ trigger: "manual" });
    expect(result).toEqual({
      action: "dialed",
      applicantId: APPLICANT.id,
      conversationId: "conv_abc",
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(url).toContain("/convai/twilio/outbound-call");
    const body = JSON.parse(init.body);
    expect(body.to_number).toBe(APPLICANT.phone_e164);
    expect(body.conversation_initiation_client_data.dynamic_variables.applicant_id).toBe(
      APPLICANT.id
    );
    expect(inserts[0].sql).toContain("'dialed'");
    expect(mockResetClaim).not.toHaveBeenCalled();
    expect(mockRecordCallOutcome).not.toHaveBeenCalled();
    expect(mockStampTape).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "VOICE_INTAKE_OUTBOUND_ATTEMPTED",
        sessionId: "conv_abc",
        payload: expect.objectContaining({ dryRun: false, conversationId: "conv_abc" }),
      })
    );
  });

  it("FRANK_OUTBOUND_TEST_NUMBER reroutes every dial", async () => {
    process.env.FRANK_OUTBOUND_TEST_NUMBER = "+17025550000";
    const fetchMock = stubFetch({ ok: true, body: { conversation_id: "conv_t" } });
    routeQueries({ inFlight: false, dialsToday: 0, minsSinceLast: null });
    mockClaimNextCall.mockResolvedValue(APPLICANT);

    await runDialerTick();
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, { body: string }])[1].body);
    expect(body.to_number).toBe("+17025550000");
    // test_call column flagged true
    expect(inserts[0].params).toContain(true);
  });

  it("a test call releases the applicant claim non-destructively after a successful dial", async () => {
    process.env.FRANK_OUTBOUND_TEST_NUMBER = "+17025550000";
    stubFetch({ ok: true, body: { conversation_id: "conv_t" } });
    routeQueries({ inFlight: false, dialsToday: 0, minsSinceLast: null });
    mockClaimNextCall.mockResolvedValue(APPLICANT);

    const result = await runDialerTick();
    expect(result.action).toBe("dialed");
    expect(mockResetClaim).toHaveBeenCalledWith(APPLICANT.id);
    // A test call must NEVER disposition the borrowed real applicant.
    expect(mockRecordCallOutcome).not.toHaveBeenCalled();
  });

  it("a test call whose resetClaim throws still succeeds and never records an outcome on the applicant", async () => {
    // FIX 1: the test-call resetClaim runs AFTER a successful dial, so its failure
    // is post-dial cleanup — it must be caught and logged, never fall into the
    // dial-failure catch (which would record a bogus no_answer on the REAL applicant).
    process.env.FRANK_OUTBOUND_TEST_NUMBER = "+17025550000";
    stubFetch({ ok: true, body: { conversation_id: "conv_t" } });
    routeQueries({ inFlight: false, dialsToday: 0, minsSinceLast: null });
    mockClaimNextCall.mockResolvedValue(APPLICANT);
    mockResetClaim.mockRejectedValueOnce(new Error("sage 503"));

    const result = await runDialerTick();
    // The dial succeeded; the cleanup failure must not turn it into a dial_failed.
    expect(result.action).toBe("dialed");
    expect(result.applicantId).toBe(APPLICANT.id);
    // The critical guard: no outcome is ever recorded on the borrowed applicant.
    expect(mockRecordCallOutcome).not.toHaveBeenCalled();
    // And no dial_failed row was inserted (only the single 'dialed' row).
    expect(inserts).toHaveLength(1);
    expect(inserts[0].sql).toContain("'dialed'");
    expect(inserts.some((i) => i.sql.includes("'dial_failed'"))).toBe(false);
    // It logged a warning rather than escalating.
    expect(logger.warn).toHaveBeenCalled();
  });

  it("a failed TEST-number dial records NO outcome on the borrowed applicant", async () => {
    // FIX 1b: even when the dial itself fails, a test call must not disposition the
    // real applicant — the catch handler is guarded by !testNumber.
    process.env.FRANK_OUTBOUND_TEST_NUMBER = "+17025550000";
    stubFetch({ ok: false, status: 500, body: { error: "twilio sad" } });
    routeQueries({ inFlight: false, dialsToday: 0, minsSinceLast: null });
    mockClaimNextCall.mockResolvedValue(APPLICANT);

    const result = await runDialerTick();
    expect(result.action).toBe("dial_failed");
    // dial_failed row still recorded locally...
    expect(inserts[0].sql).toContain("'dial_failed'");
    // ...but Sage is NOT touched for the borrowed applicant.
    expect(mockRecordCallOutcome).not.toHaveBeenCalled();
  });

  it("a failed dial records no_answer on Sage so nothing wedges in_progress", async () => {
    stubFetch({ ok: false, status: 500, body: { error: "twilio sad" } });
    routeQueries({ inFlight: false, dialsToday: 0, minsSinceLast: null });
    mockClaimNextCall.mockResolvedValue(APPLICANT);

    const result = await runDialerTick();
    expect(result.action).toBe("dial_failed");
    expect(inserts[0].sql).toContain("'dial_failed'");
    expect(mockRecordCallOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        applicantId: APPLICANT.id,
        outcome: "no_answer",
        notes: expect.stringContaining("dial failed"),
      })
    );
  });
});

// ── sweepStuckCalls idempotency (FIX 3) ──────────────────────────────────────
// The sweeper must record on Sage FIRST and only mark a row 'expired' once that
// succeeds. A failed recordCallOutcome must leave the row 'dialed' (next sweep
// retries) instead of stranding it expired-but-unrecorded (which wedges the
// applicant). It returns {expired, failed}.
describe("sweepStuckCalls idempotency", () => {
  // Route the sweeper's two SQL shapes: the SELECT of stuck rows, and the
  // per-row guarded expire UPDATE. Captures every expire UPDATE for assertions.
  function routeSweep(stuckRows: Array<{ id: string; applicant_id: string; conversation_id: string | null }>): {
    expireUpdates: Array<{ sql: string; params: unknown[] }>;
  } {
    const expireUpdates: Array<{ sql: string; params: unknown[] }> = [];
    mockQuery.mockImplementation((sql: string, params: unknown[]) => {
      if (sql.includes("SELECT") && sql.includes("status = 'dialed'")) {
        return Promise.resolve({ rows: stuckRows });
      }
      if (sql.includes("UPDATE outbound_validation_calls") && sql.includes("'expired'")) {
        expireUpdates.push({ sql, params: params as unknown[] });
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });
    return { expireUpdates };
  }

  it("returns {expired:0,failed:0} when the master flag is off and never queries", async () => {
    process.env.FRANK_OUTBOUND_ENABLED = "false";
    expect(await sweepStuckCalls()).toEqual({ expired: 0, failed: 0 });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("records on Sage then expires each stuck row", async () => {
    const { expireUpdates } = routeSweep([
      { id: "call-a", applicant_id: "appl-a", conversation_id: "conv-a" },
      { id: "call-b", applicant_id: "appl-b", conversation_id: null },
    ]);

    const result = await sweepStuckCalls();
    expect(result).toEqual({ expired: 2, failed: 0 });
    expect(mockRecordCallOutcome).toHaveBeenCalledTimes(2);
    expect(mockRecordCallOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ applicantId: "appl-a", outcome: "no_answer" })
    );
    // Each expire UPDATE is guarded on still-'dialed' and targets a single id.
    expect(expireUpdates).toHaveLength(2);
    for (const u of expireUpdates) {
      expect(u.sql).toContain("status = 'dialed'");
      expect(u.sql).toContain("WHERE id = $1");
    }
    expect(expireUpdates.map((u) => u.params[0])).toEqual(["call-a", "call-b"]);
  });

  it("leaves a row 'dialed' (no expire UPDATE) and counts it failed when its Sage write throws", async () => {
    const { expireUpdates } = routeSweep([
      { id: "call-a", applicant_id: "appl-a", conversation_id: "conv-a" },
      { id: "call-b", applicant_id: "appl-b", conversation_id: "conv-b" },
    ]);
    // First row's Sage write fails; second succeeds.
    mockRecordCallOutcome
      .mockReset()
      .mockRejectedValueOnce(new Error("sage down"))
      .mockResolvedValueOnce(undefined);

    const result = await sweepStuckCalls();
    expect(result).toEqual({ expired: 1, failed: 1 });
    // Only the succeeding row (call-b) got an expire UPDATE; the failing one stays dialed.
    expect(expireUpdates).toHaveLength(1);
    expect(expireUpdates[0].params[0]).toBe("call-b");
    // The failure was logged at error level.
    expect(logger.error).toHaveBeenCalled();
  });

  it("no stuck rows → no-op", async () => {
    routeSweep([]);
    expect(await sweepStuckCalls()).toEqual({ expired: 0, failed: 0 });
    expect(mockRecordCallOutcome).not.toHaveBeenCalled();
  });
});
