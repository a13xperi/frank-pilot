/**
 * Pure identity-key tests for src/modules/waitlist-graduation/identity.ts.
 *
 * deriveIdentityKey is the cross-property dedup primitive (phone + DOB → salted
 * hash). No DB, no env beyond the salt — so this matrix exhaustively covers
 * normalization (phone country-code collapse, DOB formats), determinism, and
 * the null path when a component is missing/unparseable.
 */

// Pin a salt so digests are deterministic across runs.
process.env.IDENTITY_HASH_SALT = "test-salt-fixed";

import {
  deriveIdentityKey,
  normalizePhoneDigits,
  normalizeDob,
  hashComponent,
} from "../modules/waitlist-graduation/identity";

describe("normalizePhoneDigits", () => {
  it("strips punctuation to digits", () => {
    expect(normalizePhoneDigits("(702) 555-1234")).toBe("7025551234");
  });

  it("collapses a US +1 11-digit number to its 10-digit core", () => {
    expect(normalizePhoneDigits("+1 702 555 1234")).toBe("7025551234");
    expect(normalizePhoneDigits("17025551234")).toBe("7025551234");
  });

  it("returns null for too-short or empty input", () => {
    expect(normalizePhoneDigits("123")).toBeNull();
    expect(normalizePhoneDigits("")).toBeNull();
    expect(normalizePhoneDigits(null)).toBeNull();
  });
});

describe("normalizeDob", () => {
  it("accepts ISO yyyy-mm-dd", () => {
    expect(normalizeDob("1990-01-02")).toBe("1990-01-02");
  });

  it("accepts US MM/DD/YYYY and zero-pads", () => {
    expect(normalizeDob("1/2/1990")).toBe("1990-01-02");
    expect(normalizeDob("12/31/1985")).toBe("1985-12-31");
  });

  it("accepts a Date object", () => {
    expect(normalizeDob(new Date("1990-01-02T00:00:00Z"))).toBe("1990-01-02");
  });

  it("returns null for garbage", () => {
    expect(normalizeDob("not-a-date")).toBeNull();
    expect(normalizeDob(null)).toBeNull();
  });
});

describe("deriveIdentityKey", () => {
  it("is deterministic for the same (phone, DOB)", () => {
    const a = deriveIdentityKey("(702) 555-1234", "1990-01-02");
    const b = deriveIdentityKey("702-555-1234", "01/02/1990");
    expect(a).not.toBeNull();
    expect(a!.identityHash).toBe(b!.identityHash);
    expect(a!.dobHash).toBe(b!.dobHash);
    expect(a!.phoneLast4).toBe("1234");
  });

  it("matches the same person regardless of +1 country-code formatting", () => {
    const plain = deriveIdentityKey("7025551234", "1990-01-02");
    const intl = deriveIdentityKey("+17025551234", "1990-01-02");
    expect(plain!.identityHash).toBe(intl!.identityHash);
  });

  it("yields different hashes for different people", () => {
    const a = deriveIdentityKey("7025551234", "1990-01-02");
    const b = deriveIdentityKey("7025550000", "1990-01-02");
    const c = deriveIdentityKey("7025551234", "1991-01-02");
    expect(a!.identityHash).not.toBe(b!.identityHash);
    expect(a!.identityHash).not.toBe(c!.identityHash);
  });

  it("returns null when phone or DOB is missing/unparseable", () => {
    expect(deriveIdentityKey(null, "1990-01-02")).toBeNull();
    expect(deriveIdentityKey("7025551234", null)).toBeNull();
    expect(deriveIdentityKey("7025551234", "garbage")).toBeNull();
  });

  it("produces a 64-hex-char sha256 digest", () => {
    const k = deriveIdentityKey("7025551234", "1990-01-02");
    expect(k!.identityHash).toMatch(/^[0-9a-f]{64}$/);
    expect(k!.dobHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("salts the digest — changing the salt changes the hash", () => {
    const before = deriveIdentityKey("7025551234", "1990-01-02")!.identityHash;
    const saved = process.env.IDENTITY_HASH_SALT;
    jest.resetModules();
    process.env.IDENTITY_HASH_SALT = "a-different-salt";
    // Re-import under the new salt.
    const reimported = require("../modules/waitlist-graduation/identity");
    const after = reimported.deriveIdentityKey("7025551234", "1990-01-02").identityHash;
    expect(after).not.toBe(before);
    process.env.IDENTITY_HASH_SALT = saved;
  });
});

describe("hashComponent", () => {
  it("is deterministic and salted", () => {
    expect(hashComponent("1990-01-02")).toBe(hashComponent("1990-01-02"));
    expect(hashComponent("1990-01-02")).toMatch(/^[0-9a-f]{64}$/);
  });
});
