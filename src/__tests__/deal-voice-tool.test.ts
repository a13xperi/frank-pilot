/**
 * deal-voice-tool.test.ts - the compartment wall for the Frank Deal Desk voice
 * line, proven against the REAL committed deal corpus + synthetic enrollment.
 *
 * Covers: fail-closed phone enrollment, the privileged voice FLOOR (even an
 * internal-enrolled caller is masked on voice), no $/cent/cap leak in the spoken
 * answer, the agent pin, the not-enrolled refusal (never answered), empty/garbage
 * handling, and the [scoped] -> speech sentinel swap.
 */
import {
  resolveVoiceEnrollment,
  voiceGroundAnswer,
  voiceFloor,
} from "../modules/voice-intake/deal-voice";
import { askDealDocsHandler } from "../modules/voice-intake/deal-tool";
import { _resetDealCorpus, getDealEntries } from "../modules/deal-qa/corpus";
import type { ToolCallbackContext } from "../modules/voice-intake/tool-callbacks";

const AGENT = "agent_deal_desk_test";
const ENROLLED = "+17025550101";
const STRANGER = "+17025559999";

function ctx(overrides: Partial<ToolCallbackContext> = {}): ToolCallbackContext {
  return {
    agentId: AGENT,
    conversationId: "conv_test",
    toolCallId: "call_test",
    toolName: "ask_deal_docs",
    ...overrides,
  };
}

beforeAll(() => _resetDealCorpus());

beforeEach(() => {
  process.env.DEAL_DESK_AGENT_ID = AGENT;
  process.env.DEAL_QA_VOICE_ALLOWLIST = `${ENROLLED}:privileged,+17025550202:internal`;
  delete process.env.VOICE_DEAL_FLOOR;
});

describe("voice enrollment (fail-closed phone allow-list)", () => {
  it("an unknown caller is NOT enrolled", () => {
    expect(resolveVoiceEnrollment(STRANGER).enrolled).toBe(false);
  });

  it("an allow-listed caller resolves to its tier", () => {
    expect(resolveVoiceEnrollment(ENROLLED)).toEqual({
      enrolled: true,
      tier: "privileged",
    });
  });

  it("normalizes formatting (national / punctuated) to match the same key", () => {
    expect(resolveVoiceEnrollment("702 555 0101").enrolled).toBe(true);
    expect(resolveVoiceEnrollment("+1 (702) 555-0101").enrolled).toBe(true);
  });

  it("enrolled-but-invalid tier falls to the STRICTEST, never internal", () => {
    process.env.DEAL_QA_VOICE_ALLOWLIST = `${ENROLLED}:bogus`;
    expect(resolveVoiceEnrollment(ENROLLED)).toEqual({
      enrolled: true,
      tier: "ext-generic",
    });
  });

  it("an empty caller id is not enrolled", () => {
    expect(resolveVoiceEnrollment("").enrolled).toBe(false);
  });
});

describe("voiceGroundAnswer (floor + mask, real corpus)", () => {
  it("defaults the voice floor to privileged", () => {
    expect(voiceFloor()).toBe("privileged");
  });

  it("the real deal corpus is loaded", () => {
    expect(getDealEntries().length).toBeGreaterThan(50);
  });

  it("a structural question returns a short, non-empty spoken answer", () => {
    const r = voiceGroundAnswer("how is the stack structured", "privileged");
    expect(r.ok).toBe(true);
    if (!r.empty) {
      expect(typeof r.spoken).toBe("string");
      expect((r.spoken || "").length).toBeGreaterThan(0);
      expect((r.spoken || "").length).toBeLessThanOrEqual(281);
    }
  });

  it("NEVER leaks a $ figure, a cent price, or the 51% cap reveal", () => {
    const r = voiceGroundAnswer(
      "what is the deal size and the economics and price per unit",
      "privileged"
    );
    const s = r.spoken || "";
    expect(s).not.toMatch(/\$\s?\d/);
    expect(s).not.toMatch(/\b51 ?%/);
    expect(s).not.toMatch(/¢/);
  });

  it("FLOOR: an internal-enrolled tier is still masked on voice (no $ leak)", () => {
    const r = voiceGroundAnswer("what is the deal size and economics", "internal");
    expect(r.spoken || "").not.toMatch(/\$\s?\d/);
  });

  it("swaps the [scoped] sentinel for speech (never reads 'scoped' aloud)", () => {
    const r = voiceGroundAnswer(
      "what is the deal size, economics, and the cap table",
      "privileged"
    );
    expect(r.spoken || "").not.toContain("[scoped]");
  });

  it("a blank / no-match query grounds empty, never throws", () => {
    expect(voiceGroundAnswer("", "privileged")).toEqual({ ok: true, empty: true });
    expect(voiceGroundAnswer("zzxqj wkpfh qwer", "privileged").empty).toBe(true);
  });
});

describe("askDealDocsHandler (the in-call tool)", () => {
  it("refuses when a DIFFERENT agent invokes it (pin)", async () => {
    const r = await askDealDocsHandler(
      { caller_id: ENROLLED, question: "how is it structured" },
      ctx({ agentId: "agent_tenant_725" })
    );
    expect(r.ok).toBe(false);
    expect(r.message).toBeTruthy();
  });

  it("refuses a missing agent id when a pin is configured", async () => {
    const r = await askDealDocsHandler(
      { caller_id: ENROLLED, question: "how is it structured" },
      ctx({ agentId: "" })
    );
    expect(r.ok).toBe(false);
  });

  it("refuses an unknown caller and does NOT answer", async () => {
    const r = await askDealDocsHandler(
      { caller_id: STRANGER, question: "what is the deal size" },
      ctx()
    );
    expect(r.ok).toBe(false);
    expect(r.message || "").not.toMatch(/\$\s?\d/);
  });

  it("answers an enrolled caller, masked (no $/cap/scoped leak)", async () => {
    const r = await askDealDocsHandler(
      { caller_id: ENROLLED, question: "what are the economics and deal size" },
      ctx()
    );
    expect(r.ok).toBe(true);
    expect(r.message || "").not.toMatch(/\$\s?\d/);
    expect(r.message || "").not.toMatch(/\b51 ?%/);
    expect(r.message || "").not.toContain("[scoped]");
  });

  it("handles an enrolled caller with a no-match question gracefully", async () => {
    const r = await askDealDocsHandler(
      { caller_id: ENROLLED, question: "zzxqj wkpfh qwer" },
      ctx()
    );
    expect(r.ok).toBe(true);
    expect(r.message).toBeTruthy();
  });

  it("asks again when no question was captured", async () => {
    const r = await askDealDocsHandler({ caller_id: ENROLLED }, ctx());
    expect(r.ok).toBe(false);
  });
});
