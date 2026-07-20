/**
 * Tests for the request_transfer voice tool — exercised through the real
 * follow-ups service with a mocked DB (mirrors follow-up-tools.test.ts). Verifies
 * the dark feature flag, the required-field re-asks, the durable follow_ups
 * filing (source + no-consent + structured notes), and the spoken ticket id.
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
// follow-ups/service imports caller-history at module load — stub it so the
// module graph resolves without touching the real DB config.
jest.mock("../modules/caller-history/service", () => ({
  getCallerHistory: jest.fn(),
  buildRapportSummary: jest.fn(),
}));

import {
  requestTransferHandler,
  registerRequestTransferHandler,
  formatTicketId,
  __resetRegistrationForTests,
} from "../modules/voice-intake/request-transfer";
import {
  clearToolHandlersForTests,
  getRegisteredToolNames,
} from "../modules/voice-intake/tool-callbacks";

const CTX = {
  agentId: "a",
  conversationId: "conv_TR",
  toolCallId: "tc",
  toolName: "request_transfer" as const,
};
const ROW_ID = "4f2a9c1e-89ab-4cde-8123-456789abcdef";
const FULL = {
  caller_name: "Maria Gonzalez",
  phone_e164: "+17025551234",
  current_property: "Donna Louise Apartments",
  current_unit: "204",
  desired_property: "Sarah Ann Knights",
  desired_unit_type: "2-bedroom",
  reason: "needs a ground-floor unit closer to family",
};

const ORIG_FLAG = process.env.FRANK_TRANSFER_ENABLED;

/** A follow_ups INSERT ... RETURNING row for the happy path. */
function mockInsertRow(id = ROW_ID): void {
  mockQuery.mockResolvedValueOnce({
    rows: [
      {
        id,
        phone_e164: FULL.phone_e164,
        reason: "transfer_requested",
        scheduled_for: "2026-07-02T00:00:00.000Z",
        status: "pending",
        attempts: 0,
        notes: null,
        checkpoint: null,
      },
    ],
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.FRANK_TRANSFER_ENABLED = "true";
});
afterAll(() => {
  if (ORIG_FLAG === undefined) delete process.env.FRANK_TRANSFER_ENABLED;
  else process.env.FRANK_TRANSFER_ENABLED = ORIG_FLAG;
});

describe("formatTicketId", () => {
  it("makes a short, speakable TR- code from the first 8 hex of the uuid", () => {
    expect(formatTicketId(ROW_ID)).toBe("TR-4F2A9C1E");
  });
});

describe("request_transfer — flag gate", () => {
  it("fails closed (ok:false, no DB write) when FRANK_TRANSFER_ENABLED is off", async () => {
    process.env.FRANK_TRANSFER_ENABLED = "false";
    const r = await requestTransferHandler(FULL, CTX);
    expect(r.ok).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe("request_transfer — required fields", () => {
  it("re-asks for phone when missing (no DB write)", async () => {
    const { phone_e164, ...noPhone } = FULL;
    const r = await requestTransferHandler(noPhone, CTX);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/phone/i);
    expect(mockQuery).not.toHaveBeenCalled();
  });
  it("re-asks for the caller's name when missing", async () => {
    const { caller_name, ...noName } = FULL;
    const r = await requestTransferHandler(noName, CTX);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/name/i);
    expect(mockQuery).not.toHaveBeenCalled();
  });
  it("re-asks for the current property when missing", async () => {
    const { current_property, ...noCurrent } = FULL;
    const r = await requestTransferHandler(noCurrent, CTX);
    expect(r.ok).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });
  it("re-asks for the desired property when missing", async () => {
    const { desired_property, ...noDesired } = FULL;
    const r = await requestTransferHandler(noDesired, CTX);
    expect(r.ok).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe("request_transfer — happy path", () => {
  it("files a follow_ups row and returns a spoken ticket id", async () => {
    mockInsertRow();
    const r = await requestTransferHandler(FULL, CTX);

    expect(r.ok).toBe(true);
    expect(r.result?.ticket_id).toBe("TR-4F2A9C1E");
    expect(r.result?.request_id).toBe(ROW_ID);
    expect(r.result?.status).toBe("filed");
    expect(r.result?.classification).toBe("pending_compliance_review");
    expect(r.message).toContain("TR-4F2A9C1E");

    // Persisted via the reused follow_ups spine, exactly one INSERT.
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("INSERT INTO follow_ups");
    // params order (service.createFollowUp): phone, userId, voiceCallId, reason,
    // scheduled_for, consent_outbound, notes, checkpoint, source
    expect(params[3]).toBe("transfer_requested"); // reason (categorical)
    expect(params[5]).toBe(false); // consent_outbound — never auto-dialed
    expect(params[8]).toBe("voice_intake_transfer"); // source marker

    // notes carries the structured compliance payload verbatim.
    const notes = JSON.parse(params[6] as string);
    expect(notes.kind).toBe("unit_transfer");
    expect(notes.caller_name).toBe(FULL.caller_name);
    expect(notes.current_property).toBe(FULL.current_property);
    expect(notes.current_unit).toBe(FULL.current_unit);
    expect(notes.desired_property).toBe(FULL.desired_property);
    expect(notes.desired_unit_type).toBe(FULL.desired_unit_type);
    expect(notes.reason).toBe(FULL.reason);
  });

  it("files with only the four required fields (optionals default to null)", async () => {
    mockInsertRow();
    const r = await requestTransferHandler(
      {
        caller_name: FULL.caller_name,
        phone_e164: FULL.phone_e164,
        current_property: FULL.current_property,
        desired_property: FULL.desired_property,
      },
      CTX
    );
    expect(r.ok).toBe(true);
    const notes = JSON.parse((mockQuery.mock.calls[0] as [string, unknown[]])[1][6] as string);
    expect(notes.current_unit).toBeNull();
    expect(notes.desired_unit_type).toBeNull();
    expect(notes.reason).toBeNull();
  });
});

describe("request_transfer — registration", () => {
  it("registers request_transfer on the shared dispatch table", () => {
    clearToolHandlersForTests();
    __resetRegistrationForTests();
    registerRequestTransferHandler();
    expect(getRegisteredToolNames()).toEqual(expect.arrayContaining(["request_transfer"]));
  });
});
