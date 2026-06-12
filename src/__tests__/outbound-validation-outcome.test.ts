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
jest.mock("../modules/auth/magic-link-service", () => ({ sendMagicLinkSms: jest.fn() }));

import {
  mapPostCallToOutcome,
  isOutboundValidationEvent,
} from "../modules/outbound-validation/outcome";
import type { PostCallPayload } from "../modules/voice-intake/service";

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
