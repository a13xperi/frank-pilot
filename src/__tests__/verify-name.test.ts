/**
 * Tests for the Phase 0a name-accuracy slice:
 *   - src/modules/voice-intake/name-matching.ts (fuzzyMatchName / seqRatio)
 *   - src/modules/voice-intake/verify-name.ts   (verifyNameHandler)
 *
 * fuzzyMatchName is pure and tested directly. The handler is tested against a
 * mocked Sage roster + a stubbed VOICE_TOOLS_ENABLED flag so we never touch the
 * network or a real env.
 */

jest.mock("../config/database", () => ({ query: jest.fn() }));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockListApplicants = jest.fn();
jest.mock("../modules/outbound-validation/sage-client", () => ({
  listApplicants: (...args: unknown[]) => mockListApplicants(...args),
}));

// normalizePhone is the real impl from service.ts — no mock needed; it's pure.

import { fuzzyMatchName, seqRatio } from "../modules/voice-intake/name-matching";
import {
  verifyNameHandler,
  __resetRegistrationForTests,
} from "../modules/voice-intake/verify-name";
import type { ToolCallbackContext } from "../modules/voice-intake/tool-callbacks";

const ROSTER = [
  { full_name: "Shawana Hamomona" },
  { full_name: "Robert Owens" },
  { full_name: "Maria Gonzalez" },
  { full_name: "James Carter" },
];

const ctx: ToolCallbackContext = {
  agentId: "agent_test",
  conversationId: "conv_test",
  toolCallId: "tc_test",
  toolName: "verify_name",
};

beforeEach(() => {
  jest.clearAllMocks();
  __resetRegistrationForTests();
  process.env.VOICE_TOOLS_ENABLED = "true";
  mockListApplicants.mockResolvedValue(ROSTER);
});

afterAll(() => {
  delete process.env.VOICE_TOOLS_ENABLED;
});

describe("seqRatio", () => {
  it("is 1 for identical strings and 0 when one is empty", () => {
    expect(seqRatio("evans", "evans")).toBe(1);
    expect(seqRatio("", "evans")).toBe(0);
    expect(seqRatio("", "")).toBe(1);
  });
});

describe("fuzzyMatchName", () => {
  it("returns no match for clearly distinct surnames (Evans vs Owens)", () => {
    // Full heard signal "Evan Evans" against the roster surname "Owens": the
    // surname pair sits right at the 0.6 floor, but the full-name signal pulls
    // the max below threshold, so a misheard "Evans" never silently becomes
    // "Owens".
    const res = fuzzyMatchName("Evan Evans", "Evans", [{ full_name: "Robert Owens" }]);
    expect(res.match).toBeNull();
    expect(res.confidence).toBeLessThan(0.61);
  });

  it("matches a misheard surname with high confidence (Hamamona -> Hamomona)", () => {
    const res = fuzzyMatchName("Shawana Hamamona", "Hamomona", ROSTER);
    expect(res.match).not.toBeNull();
    expect(res.match?.full_name).toBe("Shawana Hamomona");
    expect(res.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("respects a custom threshold (a strong match still loses to an impossible bar)", () => {
    // "James Carter" full-name vs roster — a single-char-off surname scores
    // high but below a 0.99 bar, proving the threshold is honored.
    const high = fuzzyMatchName("James Carver", "Carver", ROSTER, 0.99);
    expect(high.match).toBeNull();
    expect(high.confidence).toBeGreaterThanOrEqual(0.6);
    expect(high.confidence).toBeLessThan(0.99);
  });
});

describe("verifyNameHandler", () => {
  it("fails closed when VOICE_TOOLS_ENABLED is not 'true'", async () => {
    delete process.env.VOICE_TOOLS_ENABLED;
    const res = await verifyNameHandler(
      { heard_name: "Shawana Hamamona", spelled_last_name: "Hamomona" },
      ctx
    );
    expect(res.ok).toBe(false);
    expect(mockListApplicants).not.toHaveBeenCalled();
  });

  it("returns a confident match and a confirming message", async () => {
    const res = await verifyNameHandler(
      { heard_name: "Shawana Hamamona", spelled_last_name: "Hamomona", phone: "702-555-0123" },
      ctx
    );
    expect(res.ok).toBe(true);
    expect(res.result).toMatchObject({
      matched_name: "Shawana Hamomona",
      needs_review: false,
    });
    expect(res.result?.confidence as number).toBeGreaterThanOrEqual(0.85);
    expect(res.message).toContain("Shawana Hamomona");
    expect(res.message).toMatch(/thanks for confirming/i);
  });

  it("returns no match with a get-you-added message when the name isn't on the roster", async () => {
    const res = await verifyNameHandler(
      { heard_name: "Zachary Quill", spelled_last_name: "Quill" },
      ctx
    );
    expect(res.ok).toBe(true);
    expect(res.result).toMatchObject({ matched_name: null, needs_review: true });
    expect(res.message).toMatch(/not finding that name/i);
  });

  it("flags needs_review for a mid-confidence best guess (0.6 < conf < 0.85)", async () => {
    // "Jim Carver" lands ~0.83 against "James Carter": a real candidate, but
    // not confident enough to assert — the agent should confirm, not assume.
    const res = await verifyNameHandler(
      { heard_name: "Jim Carver", spelled_last_name: "Carver" },
      ctx
    );
    expect(res.ok).toBe(true);
    expect(res.result?.matched_name).toBe("James Carter");
    expect(res.result?.confidence as number).toBeGreaterThan(0.6);
    expect(res.result?.confidence as number).toBeLessThan(0.85);
    expect(res.result?.needs_review).toBe(true);
    expect(res.message).toMatch(/did I get that right/i);
  });

  it("asks again when no name inputs are provided", async () => {
    const res = await verifyNameHandler({}, ctx);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/didn't catch your name/i);
    expect(mockListApplicants).not.toHaveBeenCalled();
  });
});
