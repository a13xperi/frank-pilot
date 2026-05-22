/**
 * BP-02 Compliance Tape — hashing primitive unit tests.
 *
 * These tests exercise pure functions only (canonicalJson, computeEntryHash,
 * GENESIS_HASH). No IO, no service layer — runs on every branch including
 * bp-02/lane-f-tests standalone.
 */

import {
  canonicalJson,
  computeEntryHash,
  GENESIS_HASH,
  hashToHex,
} from "../hashing";
import type { TapeJsonLdPayload } from "../types";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const FIXED_CREATED_AT = "2026-01-01T00:00:00.000Z";

function makePayload(overrides: Partial<TapeJsonLdPayload> = {}): TapeJsonLdPayload {
  return {
    "@context": "https://frank-pilot.example/compliance-tape/v1",
    "@type": "ComplianceEvent.Test",
    actorId: null,
    subjectId: "applicant-test-1",
    ruleCitation: "HUD 4350.3 Ch. 4-4",
    ...overrides,
  };
}

// ── canonicalJson ─────────────────────────────────────────────────────────────

describe("canonicalJson", () => {
  it("sorts keys lexicographically at the top level", () => {
    const obj = { z: 1, a: 2, m: 3 };
    const result = canonicalJson(obj);
    expect(result).toBe('{"a":2,"m":3,"z":1}');
  });

  it("sorts keys at every depth (nested objects are also sorted)", () => {
    const obj = {
      z: { nested_z: 1, nested_a: 2 },
      a: { x: { deeper_b: "hello", deeper_a: "world" } },
    };
    const result = canonicalJson(obj);
    // Outer keys: a, z — then inner keys sorted
    expect(result).toBe(
      '{"a":{"x":{"deeper_a":"world","deeper_b":"hello"}},"z":{"nested_a":2,"nested_z":1}}'
    );
  });

  it("produces identical output regardless of input key order", () => {
    const objA = { b: 2, a: 1, c: 3 };
    const objB = { c: 3, a: 1, b: 2 };
    const objC = { a: 1, c: 3, b: 2 };
    const out = canonicalJson(objA);
    expect(canonicalJson(objB)).toBe(out);
    expect(canonicalJson(objC)).toBe(out);
  });

  it("preserves array order (arrays are NOT sorted)", () => {
    const obj = { items: [3, 1, 2, "z", "a"] };
    const result = canonicalJson(obj);
    expect(result).toBe('{"items":[3,1,2,"z","a"]}');
  });

  it("preserves array order in nested arrays", () => {
    const obj = { events: [{ b: 2, a: 1 }, { z: "last", a: "first" }] };
    const result = canonicalJson(obj);
    // Objects inside arrays get key-sorted, but array order preserved
    expect(result).toBe('{"events":[{"a":1,"b":2},{"a":"first","z":"last"}]}');
  });

  it("handles null values without throwing", () => {
    const obj = { actorId: null, subjectId: "x" };
    const result = canonicalJson(obj);
    expect(result).toBe('{"actorId":null,"subjectId":"x"}');
  });

  it("handles the actual TapeJsonLdPayload shape consistently", () => {
    const payloadUnsorted: TapeJsonLdPayload = {
      subjectId: "app-1",
      "@type": "ComplianceEvent.WelcomeLetter",
      ruleCitation: "HUD 4350.3 Ch. 4-4",
      "@context": "https://frank-pilot.example/compliance-tape/v1",
      actorId: "sys",
    };
    const payloadPresorted: TapeJsonLdPayload = {
      "@context": "https://frank-pilot.example/compliance-tape/v1",
      "@type": "ComplianceEvent.WelcomeLetter",
      actorId: "sys",
      ruleCitation: "HUD 4350.3 Ch. 4-4",
      subjectId: "app-1",
    };
    expect(canonicalJson(payloadUnsorted)).toBe(canonicalJson(payloadPresorted));
  });
});

// ── GENESIS_HASH ──────────────────────────────────────────────────────────────

describe("GENESIS_HASH", () => {
  it("is exactly 32 bytes", () => {
    expect(GENESIS_HASH.length).toBe(32);
  });

  it("is all zero bytes", () => {
    expect(GENESIS_HASH.every((b) => b === 0)).toBe(true);
  });

  it("hex representation is 64 zero chars", () => {
    expect(GENESIS_HASH.toString("hex")).toBe(
      "0000000000000000000000000000000000000000000000000000000000000000"
    );
  });
});

// ── computeEntryHash ──────────────────────────────────────────────────────────

describe("computeEntryHash", () => {
  it("is deterministic — same inputs always produce the same hash", () => {
    const payload = makePayload();
    const link = {
      sequence: 1,
      prevHash: GENESIS_HASH,
      payload,
      createdAt: FIXED_CREATED_AT,
    };
    const h1 = computeEntryHash(link);
    const h2 = computeEntryHash(link);
    expect(h1.toString("hex")).toBe(h2.toString("hex"));
  });

  it("different sequence numbers produce different hashes", () => {
    const payload = makePayload();
    const h1 = computeEntryHash({
      sequence: 1,
      prevHash: GENESIS_HASH,
      payload,
      createdAt: FIXED_CREATED_AT,
    });
    const h2 = computeEntryHash({
      sequence: 2,
      prevHash: GENESIS_HASH,
      payload,
      createdAt: FIXED_CREATED_AT,
    });
    expect(h1.toString("hex")).not.toBe(h2.toString("hex"));
  });

  it("different prevHash values produce different hashes", () => {
    const payload = makePayload();
    const prevHashA = GENESIS_HASH;
    const prevHashB = Buffer.alloc(32, 0xff); // all 0xFF
    const h1 = computeEntryHash({
      sequence: 2,
      prevHash: prevHashA,
      payload,
      createdAt: FIXED_CREATED_AT,
    });
    const h2 = computeEntryHash({
      sequence: 2,
      prevHash: prevHashB,
      payload,
      createdAt: FIXED_CREATED_AT,
    });
    expect(h1.toString("hex")).not.toBe(h2.toString("hex"));
  });

  it("different payloads produce different hashes", () => {
    const payloadA = makePayload({ subjectId: "applicant-A" });
    const payloadB = makePayload({ subjectId: "applicant-B" });
    const h1 = computeEntryHash({
      sequence: 1,
      prevHash: GENESIS_HASH,
      payload: payloadA,
      createdAt: FIXED_CREATED_AT,
    });
    const h2 = computeEntryHash({
      sequence: 1,
      prevHash: GENESIS_HASH,
      payload: payloadB,
      createdAt: FIXED_CREATED_AT,
    });
    expect(h1.toString("hex")).not.toBe(h2.toString("hex"));
  });

  it("different createdAt values produce different hashes", () => {
    const payload = makePayload();
    const h1 = computeEntryHash({
      sequence: 1,
      prevHash: GENESIS_HASH,
      payload,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const h2 = computeEntryHash({
      sequence: 1,
      prevHash: GENESIS_HASH,
      payload,
      createdAt: "2026-01-01T00:00:00.001Z", // 1ms later
    });
    expect(h1.toString("hex")).not.toBe(h2.toString("hex"));
  });

  it("returns a 32-byte Buffer", () => {
    const result = computeEntryHash({
      sequence: 1,
      prevHash: GENESIS_HASH,
      payload: makePayload(),
      createdAt: FIXED_CREATED_AT,
    });
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.length).toBe(32);
  });

  it("throws if prevHash is not 32 bytes", () => {
    expect(() =>
      computeEntryHash({
        sequence: 1,
        prevHash: Buffer.alloc(16), // wrong size
        payload: makePayload(),
        createdAt: FIXED_CREATED_AT,
      })
    ).toThrow(/32 bytes/);
  });

  it("throws if sequence is not a positive integer", () => {
    expect(() =>
      computeEntryHash({
        sequence: 0,
        prevHash: GENESIS_HASH,
        payload: makePayload(),
        createdAt: FIXED_CREATED_AT,
      })
    ).toThrow();
  });

  /**
   * Genesis lock-in test.
   *
   * Computed once with these exact inputs and locked in as a regression anchor.
   * Any change to canonicalJson ordering, the digest input format, or GENESIS_HASH
   * will break this test — intentional per docs/bp-02-contracts.md §8.
   *
   * Input payload (keys in creation order, sorted by canonicalJson at hash time):
   *   @context  "https://frank-pilot.example/compliance-tape/v1"
   *   @type     "ComplianceEvent.Test"
   *   actorId   null
   *   subjectId "applicant-genesis"
   *   ruleCitation "HUD 4350.3 Ch. 4-4"
   *
   * sequence=1, prevHash=GENESIS_HASH (32 zero bytes), createdAt=FIXED_CREATED_AT
   */
  it("genesis case: sequence=1, prevHash=GENESIS_HASH produces known hash", () => {
    const genesisPayload: TapeJsonLdPayload = {
      "@context": "https://frank-pilot.example/compliance-tape/v1",
      "@type": "ComplianceEvent.Test",
      actorId: null,
      subjectId: "applicant-genesis",
      ruleCitation: "HUD 4350.3 Ch. 4-4",
    };
    const result = computeEntryHash({
      sequence: 1,
      prevHash: GENESIS_HASH,
      payload: genesisPayload,
      createdAt: FIXED_CREATED_AT,
    });
    // Hash locked in — do not change without bumping the schema version.
    expect(result.toString("hex")).toBe(
      "33f1cfe6f33937c01c78435fb2ca2d4ae5a60a01012b0cc01927d8dabd606839"
    );
  });

  it("hashToHex round-trip: hash → hex is 64 lowercase hex chars", () => {
    const buf = computeEntryHash({
      sequence: 1,
      prevHash: GENESIS_HASH,
      payload: makePayload(),
      createdAt: FIXED_CREATED_AT,
    });
    const hex = hashToHex(buf);
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
  });
});
