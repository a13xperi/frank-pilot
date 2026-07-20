/**
 * Tests for get_property_details — free address + senior/family + amenities on
 * the call. Sources from the GPM corpus (docs/intel/gpmglv-properties-extracted.json)
 * via the housing-qa index, so these run against the REAL bundled corpus — no DB
 * mock. This is deliberate: the old DB-mocked test was green while prod returned
 * `amenities: []` and failed to resolve "Donna Louise 2" / "David J Hoggard"
 * (name drift in the operational table). Asserting against the corpus closes that
 * mock-vs-reality gap.
 */
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import {
  getPropertyDetailsHandler,
  registerGetPropertyDetailsHandler,
  __resetRegistrationForTests,
} from "../modules/voice-intake/get-property-details";
import {
  clearToolHandlersForTests,
  getRegisteredToolNames,
} from "../modules/voice-intake/tool-callbacks";

const CTX = {
  agentId: "a",
  conversationId: "c",
  toolCallId: "t",
  toolName: "get_property_details" as const,
};

describe("getPropertyDetailsHandler (corpus-sourced)", () => {
  it("ok:false without a property name", async () => {
    const r = await getPropertyDetailsHandler({}, CTX);
    expect(r.ok).toBe(false);
  });

  it("ok:false on no match", async () => {
    const r = await getPropertyDetailsHandler({ property_name: "Hogwarts Castle" }, CTX);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/couldn't find/i);
  });

  it("resolves 'Donna Louise 2' — the name the old DB lookup missed", async () => {
    // DB row is "Donna Louise Apartments 2"; caller/agent says "Donna Louise 2".
    const r = await getPropertyDetailsHandler({ property_name: "Donna Louise 2" }, CTX);
    expect(r.ok).toBe(true);
    expect(r.result?.name).toMatch(/Donna Louise 2/i);
    expect(r.result?.is_senior).toBe(false);
    expect(r.result?.type).toBe("family");
    expect((r.result?.amenities as string[]).length).toBeGreaterThan(0);
    expect(r.result?.address).toMatch(/Donna St/i);
    expect(r.message).toContain("Amenities include");
  });

  it("resolves 'David J Hoggard' (punctuation drift) with rich amenities", async () => {
    // Corpus name is "David J. Hoggard Family Community" (note the period).
    const r = await getPropertyDetailsHandler({ property_name: "David J Hoggard" }, CTX);
    expect(r.ok).toBe(true);
    expect(r.result?.type).toBe("family");
    const amenities = (r.result?.amenities as string[]).map((a) => a.toLowerCase());
    expect(amenities.length).toBeGreaterThan(0);
    expect(amenities.some((a) => a.includes("fitness"))).toBe(true);
  });

  it("returns the senior flag + non-empty amenities for a senior community", async () => {
    const r = await getPropertyDetailsHandler({ property_name: "Ethel Mae Robinson" }, CTX);
    expect(r.ok).toBe(true);
    expect(r.result?.is_senior).toBe(true);
    expect((r.result?.amenities as string[]).length).toBeGreaterThan(0);
    expect(r.message).toContain("senior");
  });

  it("a statewide-style name variant ('… Senior 2') still lands on the GPM record, never amenity-less", async () => {
    // The matcher pool is the 17 GPM records only; a near-duplicate statewide
    // variant must resolve to the canonical in-pool community (which always
    // carries amenities), not miss or match an amenity-less off-scope record.
    const r = await getPropertyDetailsHandler({ property_name: "Ethel Mae Robinson Senior 2" }, CTX);
    expect(r.ok).toBe(true);
    expect(r.result?.name).toMatch(/Ethel Mae Robinson/i);
    expect((r.result?.amenities as string[]).length).toBeGreaterThan(0);
  });

  it("disambiguates the in-pool siblings: 'Ethel Mae Fletcher' is not stolen by Robinson", async () => {
    const r = await getPropertyDetailsHandler({ property_name: "Ethel Mae Fletcher" }, CTX);
    expect(r.ok).toBe(true);
    expect(r.result?.name).toMatch(/Fletcher/i);
    expect(r.result?.name).not.toMatch(/Robinson/i);
    expect(r.result?.type).toBe("family");
  });

  it("ok:false when the best candidate scores below MATCH_THRESHOLD (partial-similarity, not a match)", async () => {
    // Shares the "Louise" token with three communities but nothing else (best
    // candidate scores ~0.54, under the 0.6 threshold) — must decline rather
    // than guess (Frank then reads back the open options).
    const r = await getPropertyDetailsHandler({ property_name: "Louise Meadows" }, CTX);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/couldn't find/i);
  });

  it("registers the handler", () => {
    clearToolHandlersForTests();
    __resetRegistrationForTests();
    registerGetPropertyDetailsHandler();
    expect(getRegisteredToolNames()).toContain("get_property_details");
  });
});
