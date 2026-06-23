/**
 * Outcome mapping tests for src/modules/outbound-validation/outcome.ts.
 *
 * mapPostCallToOutcome is pure over the PostCallPayload shape, so the matrix
 * below exercises every precedence branch: hard signals (wrong number,
 * voicemail, no-answer heuristics) win over the interest answer, and a call
 * that reached a human but never established interest counts as no_answer so
 * the Sage retry machine takes another swing.
 */

const mockQuery = jest.fn();
jest.mock("../config/database", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock("../modules/tape", () => ({ stampTape: jest.fn().mockResolvedValue(null) }));
jest.mock("../modules/auth/magic-link-service", () => ({
  sendMagicLinkSms: jest.fn(),
  createMagicLinkByUserId: jest
    .fn()
    .mockResolvedValue({ link: "https://x/auth/callback?token=t", userId: "u1" }),
}));
jest.mock("../modules/outbound-validation/sage-client", () => ({
  recordCallOutcome: jest.fn().mockResolvedValue(undefined),
  getApplicantPhone: jest.fn().mockResolvedValue("+17025550001"),
}));

import {
  mapPostCallToOutcome,
  isOutboundValidationEvent,
  handleOutboundPostCall,
} from "../modules/outbound-validation/outcome";
import { sendMagicLinkSms } from "../modules/auth/magic-link-service";
import { recordCallOutcome } from "../modules/outbound-validation/sage-client";
import type { PostCallPayload } from "../modules/voice-intake/service";

const flush = () => new Promise((r) => setTimeout(r, 10));

const OUTBOUND_AGENT = "agent_outbound_test_123";

interface PayloadOpts {
  data?: Record<string, unknown>;
  durationSecs?: number;
  userTurns?: boolean;
  status?: string;
}

function field(value: unknown): { value: unknown } {
  return { value };
}

function buildPayload(opts: PayloadOpts = {}): PostCallPayload {
  return {
    conversation_id: "conv_test_1",
    agent_id: OUTBOUND_AGENT,
    status: opts.status ?? "done",
    transcript:
      opts.userTurns === false
        ? [{ role: "agent", message: "Hi, may I speak with Jane?" }]
        : [
            { role: "agent", message: "Hi, may I speak with Jane?" },
            { role: "user", message: "Yes, this is Jane." },
          ],
    metadata: { call_duration_secs: opts.durationSecs ?? 60 },
    analysis: { data_collection_results: opts.data ?? {} },
  };
}

describe("isOutboundValidationEvent", () => {
  const saved = process.env.ELEVENLABS_OUTBOUND_AGENT_ID;
  afterEach(() => {
    if (saved === undefined) delete process.env.ELEVENLABS_OUTBOUND_AGENT_ID;
    else process.env.ELEVENLABS_OUTBOUND_AGENT_ID = saved;
  });

  it("matches when agent_id equals the configured outbound agent", () => {
    process.env.ELEVENLABS_OUTBOUND_AGENT_ID = OUTBOUND_AGENT;
    expect(isOutboundValidationEvent(buildPayload())).toBe(true);
  });

  it("rejects a different agent (inbound intake stays on its own path)", () => {
    process.env.ELEVENLABS_OUTBOUND_AGENT_ID = "agent_other";
    expect(isOutboundValidationEvent(buildPayload())).toBe(false);
  });

  it("never matches when the outbound agent is unconfigured", () => {
    delete process.env.ELEVENLABS_OUTBOUND_AGENT_ID;
    expect(isOutboundValidationEvent(buildPayload())).toBe(false);
  });
});

describe("mapPostCallToOutcome precedence", () => {
  it("wrong_number wins over everything", () => {
    const mapped = mapPostCallToOutcome(
      buildPayload({
        data: {
          wrong_number: field(true),
          still_interested: field(true),
          reached_voicemail: field(true),
        },
      })
    );
    expect(mapped.outcome).toBe("bad_number");
    expect(mapped.stillInterested).toBeNull();
  });

  it("voicemail beats the no-answer heuristics and interest", () => {
    const mapped = mapPostCallToOutcome(
      buildPayload({
        data: { reached_voicemail: field("true"), still_interested: field(true) },
        userTurns: false,
      })
    );
    expect(mapped.outcome).toBe("voicemail");
  });

  it("failed call status maps to no_answer", () => {
    const mapped = mapPostCallToOutcome(buildPayload({ status: "failed" }));
    expect(mapped.outcome).toBe("no_answer");
  });

  it("sub-5-second calls map to no_answer", () => {
    const mapped = mapPostCallToOutcome(
      buildPayload({ durationSecs: 3, data: { still_interested: field(true) } })
    );
    expect(mapped.outcome).toBe("no_answer");
  });

  it("a call with zero user turns maps to no_answer", () => {
    const mapped = mapPostCallToOutcome(
      buildPayload({ userTurns: false, data: { still_interested: field(true) } })
    );
    expect(mapped.outcome).toBe("no_answer");
  });

  it("wants_callback beats a yes on interest", () => {
    const mapped = mapPostCallToOutcome(
      buildPayload({
        data: {
          wants_callback: field(true),
          still_interested: field(true),
          new_phone_number: field("(702) 555-0000"),
        },
      })
    );
    expect(mapped.outcome).toBe("callback_requested");
    expect(mapped.stillInterested).toBe(true);
    expect(mapped.notes).toContain("new phone: (702) 555-0000");
  });

  it("still_interested=true confirms (boolean value)", () => {
    const mapped = mapPostCallToOutcome(
      buildPayload({ data: { still_interested: field(true), call_summary: field("Confirmed 2BR.") } })
    );
    expect(mapped.outcome).toBe("confirmed");
    expect(mapped.stillInterested).toBe(true);
    expect(mapped.notes).toContain("Confirmed 2BR.");
    expect(mapped.notes).toContain("conv:conv_test_1");
  });

  it('still_interested="false" declines (stringified boolean)', () => {
    const mapped = mapPostCallToOutcome(
      buildPayload({ data: { still_interested: field("false") } })
    );
    expect(mapped.outcome).toBe("declined");
    expect(mapped.stillInterested).toBe(false);
  });

  it("a human conversation with no established interest re-queues as no_answer", () => {
    const mapped = mapPostCallToOutcome(buildPayload({ data: {} }));
    expect(mapped.outcome).toBe("no_answer");
    expect(mapped.notes).toContain("unmapped result");
  });

  it("composes apt/date confirmations into the notes", () => {
    const mapped = mapPostCallToOutcome(
      buildPayload({
        data: {
          still_interested: field("yes"),
          apt_type_confirmed: field("2 bedroom"),
          date_needed_confirmed: field("end of June"),
        },
      })
    );
    expect(mapped.outcome).toBe("confirmed");
    expect(mapped.notes).toContain("apt: 2 bedroom");
    expect(mapped.notes).toContain("needed: end of June");
  });
});

// ── GP-C: the send_app_link text handoff fires ONLY when it's safe ───────────
// This gate guards against accidentally texting a real applicant: it must fire
// only on a CONFIRMED outcome, only when FRANK_OUTBOUND_APP_LINK_ENABLED=true,
// and never on a test call (which dialed a test number, not the applicant).
describe("handleOutboundPostCall — outbound app-link gate", () => {
  const savedFlag = process.env.FRANK_OUTBOUND_APP_LINK_ENABLED;

  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    if (savedFlag === undefined) delete process.env.FRANK_OUTBOUND_APP_LINK_ENABLED;
    else process.env.FRANK_OUTBOUND_APP_LINK_ENABLED = savedFlag;
  });

  // findLocalCall SELECT → one dialed row; atomic-claim UPDATE → wins (RETURNING
  // one id); then (if the gate opens) findOrCreateUserByPhone SELECT returns an
  // existing user (so no INSERT path).
  function primeQueries(testCall: boolean) {
    mockQuery.mockReset();
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: "call-1", applicant_id: "appl-1", status: "dialed", test_call: testCall }],
      })
      .mockResolvedValueOnce({ rows: [{ id: "call-1" }] }) // atomic claim wins
      .mockResolvedValueOnce({ rows: [{ id: "u1" }] });
  }

  const confirmed = () => buildPayload({ data: { still_interested: field(true) } });

  it("confirmed + flag on + real call → texts the app link", async () => {
    process.env.FRANK_OUTBOUND_APP_LINK_ENABLED = "true";
    primeQueries(false);
    await handleOutboundPostCall(confirmed());
    await flush();
    expect(sendMagicLinkSms).toHaveBeenCalledTimes(1);
  });

  it("does NOT text when the flag is off", async () => {
    delete process.env.FRANK_OUTBOUND_APP_LINK_ENABLED;
    primeQueries(false);
    await handleOutboundPostCall(confirmed());
    await flush();
    expect(sendMagicLinkSms).not.toHaveBeenCalled();
  });

  it("does NOT text on a test call (dialed a test number, not the applicant)", async () => {
    process.env.FRANK_OUTBOUND_APP_LINK_ENABLED = "true";
    primeQueries(true);
    await handleOutboundPostCall(confirmed());
    await flush();
    expect(sendMagicLinkSms).not.toHaveBeenCalled();
  });

  it("does NOT text on a non-confirmed outcome (declined)", async () => {
    process.env.FRANK_OUTBOUND_APP_LINK_ENABLED = "true";
    primeQueries(false);
    await handleOutboundPostCall(buildPayload({ data: { still_interested: field("false") } }));
    await flush();
    expect(sendMagicLinkSms).not.toHaveBeenCalled();
  });

  // ── Sage-write gate: a test call must NEVER disposition the claimed applicant ──
  it("writes the outcome to Sage on a real call", async () => {
    primeQueries(false);
    await handleOutboundPostCall(confirmed());
    await flush();
    expect(recordCallOutcome).toHaveBeenCalledTimes(1);
    expect(recordCallOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ applicantId: "appl-1", outcome: "confirmed" })
    );
  });

  it("does NOT write to Sage on a test call, but still completes the local row", async () => {
    primeQueries(true);
    await handleOutboundPostCall(confirmed());
    await flush();
    // the critical guard: a test call dialed a test number, so the claimed real
    // applicant must not be dispositioned by it.
    expect(recordCallOutcome).not.toHaveBeenCalled();
    // the local outbound_validation_calls row is still marked completed.
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE outbound_validation_calls"),
      expect.arrayContaining(["call-1"])
    );
  });
});

// ── FIX 2: webhook idempotency + Sage-failure consistency ────────────────────
// ElevenLabs delivers post-call events at-least-once. The flip to 'completed' is
// an atomic compare-and-swap (UPDATE ... WHERE status='dialed' RETURNING id):
// only the winner records on Sage, so duplicate deliveries can't double-increment
// call_attempts. If the Sage write throws, the local row is reverted to 'dialed'
// and the error rethrown so the webhook DLQ re-delivers the whole event.
describe("handleOutboundPostCall — idempotency + Sage-failure consistency", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.FRANK_OUTBOUND_APP_LINK_ENABLED;
    (recordCallOutcome as jest.Mock).mockResolvedValue(undefined);
  });

  const confirmed = () => buildPayload({ data: { still_interested: field(true) } });

  it("fast-path: a row already 'completed' is a no-op (no claim, no Sage write)", async () => {
    mockQuery.mockReset();
    // findLocalCall returns a row already completed → early return before any claim.
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: "call-1", applicant_id: "appl-1", status: "completed", test_call: false }],
    });

    await handleOutboundPostCall(confirmed());
    await flush();

    expect(recordCallOutcome).not.toHaveBeenCalled();
    // Only the findLocalCall SELECT ran — no UPDATE was attempted.
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("duplicate delivery whose atomic claim loses the race is a no-op (Sage recorded at most once)", async () => {
    mockQuery.mockReset();
    // findLocalCall still sees 'dialed' (read before the racing webhook committed),
    // but the atomic-claim UPDATE matches 0 rows → another delivery already won.
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: "call-1", applicant_id: "appl-1", status: "dialed", test_call: false }],
      })
      .mockResolvedValueOnce({ rows: [] }); // claim lost: 0 rows returned

    await handleOutboundPostCall(confirmed());
    await flush();

    // The losing webhook must NOT record on Sage — that would double-increment.
    expect(recordCallOutcome).not.toHaveBeenCalled();
    // It attempted exactly the SELECT + the claim UPDATE, then returned.
    expect(mockQuery).toHaveBeenCalledTimes(2);
    const claimSql = (mockQuery.mock.calls[1] as [string, unknown[]])[0];
    expect(claimSql).toContain("status = 'dialed'");
    expect(claimSql).toContain("RETURNING id");
  });

  it("winner records on Sage exactly once and completes the row", async () => {
    mockQuery.mockReset();
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: "call-1", applicant_id: "appl-1", status: "dialed", test_call: false }],
      })
      .mockResolvedValueOnce({ rows: [{ id: "call-1" }] }); // claim wins

    await handleOutboundPostCall(confirmed());
    await flush();

    expect(recordCallOutcome).toHaveBeenCalledTimes(1);
    expect(recordCallOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ applicantId: "appl-1", outcome: "confirmed" })
    );
  });

  it("a Sage write that throws reverts the row to 'dialed' and rethrows (DLQ retries)", async () => {
    mockQuery.mockReset();
    const revertUpdates: Array<[string, unknown[]]> = [];
    mockQuery.mockImplementation((sql: string, params: unknown[]) => {
      if (sql.includes("SELECT") && sql.includes("FROM outbound_validation_calls")) {
        return Promise.resolve({
          rows: [{ id: "call-1", applicant_id: "appl-1", status: "dialed", test_call: false }],
        });
      }
      if (sql.includes("UPDATE") && sql.includes("'completed'")) {
        return Promise.resolve({ rows: [{ id: "call-1" }] }); // claim wins
      }
      if (sql.includes("UPDATE") && sql.includes("'dialed'") && sql.includes("outcome = NULL")) {
        revertUpdates.push([sql, params as unknown[]]);
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });
    (recordCallOutcome as jest.Mock).mockRejectedValueOnce(new Error("sage 500"));

    await expect(handleOutboundPostCall(confirmed())).rejects.toThrow("sage 500");

    // The claim was reverted: row back to 'dialed', outcome/completed_at cleared.
    expect(revertUpdates).toHaveLength(1);
    expect(revertUpdates[0][0]).toContain("SET status = 'dialed'");
    expect(revertUpdates[0][0]).toContain("outcome = NULL");
    expect(revertUpdates[0][0]).toContain("completed_at = NULL");
    expect(revertUpdates[0][1]).toEqual(["call-1"]);
  });

  it("a test call never writes to Sage, so a Sage failure can't even occur (no revert, no throw)", async () => {
    mockQuery.mockReset();
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: "call-1", applicant_id: "appl-1", status: "dialed", test_call: true }],
      })
      .mockResolvedValueOnce({ rows: [{ id: "call-1" }] }); // claim wins
    // Even if Sage WOULD throw, the guard skips it for test calls.
    (recordCallOutcome as jest.Mock).mockRejectedValue(new Error("should never be called"));

    await expect(handleOutboundPostCall(confirmed())).resolves.toBeUndefined();
    await flush();
    expect(recordCallOutcome).not.toHaveBeenCalled();
  });
});
