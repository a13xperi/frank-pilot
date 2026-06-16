/**
 * Tests for the Care Line post-call capture handler.
 * Verifies: agent-id routing, fail-closed flag, severity classification,
 * escalation row on P0, anonymity (no identity persisted for anonymous reporters),
 * and the no-PII contract on the captured payload.
 */

jest.mock("../config/database", () => ({ query: jest.fn() }));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../modules/tape", () => ({ stampTape: jest.fn() }));

import { query } from "../config/database";
import { stampTape } from "../modules/tape";
import {
  isCareLineEvent,
  handleCareLinePostCall,
} from "../modules/care-line/service";
import type { PostCallPayload } from "../modules/voice-intake/service";

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockStamp = stampTape as jest.MockedFunction<typeof stampTape>;

type DCR = Record<string, { value: unknown }>;
function payload(agentId: string, dcr: DCR): PostCallPayload {
  return {
    conversation_id: "conv_CARE_1",
    agent_id: agentId,
    analysis: { data_collection_results: dcr },
  } as unknown as PostCallPayload;
}

function okInsert() {
  // RETURNING id, reference_code from the incident insert
  return { rows: [{ id: "inc-1", reference_code: "FRANK-AB23" }] } as never;
}
function emptyInsert() {
  return { rows: [] } as never;
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.CARE_LINE_ENABLED = "true";
  process.env.ELEVENLABS_CARE_LINE_AGENT_ID = "agent_CARE";
});
afterEach(() => {
  delete process.env.CARE_LINE_ENABLED;
  delete process.env.ELEVENLABS_CARE_LINE_AGENT_ID;
});

describe("isCareLineEvent", () => {
  it("matches the configured care-line agent id", () => {
    expect(isCareLineEvent(payload("agent_CARE", {}))).toBe(true);
    expect(isCareLineEvent(payload("agent_OTHER", {}))).toBe(false);
  });
  it("is false when the env is unset", () => {
    delete process.env.ELEVENLABS_CARE_LINE_AGENT_ID;
    expect(isCareLineEvent(payload("agent_CARE", {}))).toBe(false);
  });
});

describe("handleCareLinePostCall", () => {
  it("is a no-op (no DB write) when CARE_LINE_ENABLED is off", async () => {
    delete process.env.CARE_LINE_ENABLED;
    await handleCareLinePostCall(payload("agent_CARE", { incident_category: { value: "general_info" } }));
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("captures a P0 life-safety report, escalates, and stamps the tape", async () => {
    mockQuery.mockResolvedValueOnce(okInsert()).mockResolvedValueOnce(emptyInsert());
    await handleCareLinePostCall(
      payload("agent_CARE", {
        incident_category: { value: "life_safety" },
        summary_what: { value: "smoke in the stairwell" },
        safety_flag: { value: true },
      })
    );
    expect(mockQuery).toHaveBeenCalledTimes(2); // incident insert + escalation insert
    const insertParams = mockQuery.mock.calls[0][1] as unknown[];
    expect(insertParams[1]).toBe("P0"); // severity
    expect(insertParams[2]).toBe("life_safety"); // category
    expect(insertParams[3]).toBe("escalated"); // status
    const kinds = mockStamp.mock.calls.map((c) => (c[0] as { kind: string }).kind);
    expect(kinds).toContain("CARE_LINE_ESCALATED");
    expect(kinds).toContain("CARE_LINE_CALL_CAPTURED");
  });

  it("persists NO identity for an anonymous reporter (name, phone, callback, conversation, raw payload)", async () => {
    mockQuery.mockResolvedValueOnce(okInsert());
    await handleCareLinePostCall(
      payload("agent_CARE", {
        incident_category: { value: "general_info" },
        summary_what: { value: "the laundry room light is out" },
        reporter_kind: { value: "anonymous" },
        reporter_name: { value: "Should Not Persist" },
        reporter_phone: { value: "702-555-0000" },
        callback_opt_in: { value: true },
        callback_phone: { value: "702-555-1212" },
      })
    );
    expect(mockQuery).toHaveBeenCalledTimes(1); // P3 → no escalation insert
    const p = mockQuery.mock.calls[0][1] as unknown[];
    expect(p[0]).toMatch(/^FRANK-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/); // bearer-grade ref code
    expect(p[16]).toBe("anonymous"); // reporter_kind
    expect(p[17]).toBeNull(); // reporter_name suppressed
    expect(p[18]).toBeNull(); // reporter_phone suppressed
    expect(p[19]).toBe(false); // callback_opt_in forced false
    expect(p[20]).toBeNull(); // callback_phone suppressed (the review's HIGH finding)
    expect(p[23]).toBeNull(); // conversation_id suppressed (no call-linkage for anon)
    expect(p[24]).toBeNull(); // raw_payload suppressed (no transcript/audio for anon)
  });

  it("keeps the raw payload + conversation id for a NAMED reporter", async () => {
    mockQuery.mockResolvedValueOnce(okInsert());
    await handleCareLinePostCall(
      payload("agent_CARE", {
        incident_category: { value: "move_in" },
        summary_what: { value: "move-in question" },
        reporter_kind: { value: "named" },
      })
    );
    const p = mockQuery.mock.calls[0][1] as unknown[];
    expect(p[23]).toBe("conv_CARE_1"); // conversation_id kept
    expect(typeof p[24]).toBe("string"); // raw_payload kept (JSON string)
  });

  it("retries on a duplicate reference code then succeeds", async () => {
    const dup = Object.assign(new Error("dup"), { code: "23505" });
    mockQuery.mockRejectedValueOnce(dup).mockResolvedValueOnce(okInsert());
    await handleCareLinePostCall(
      payload("agent_CARE", { incident_category: { value: "move_in" }, summary_what: { value: "when can I move in?" } })
    );
    expect(mockQuery).toHaveBeenCalledTimes(2); // first insert collides, retry succeeds (P3, no escalation)
  });
});
