/**
 * Tests for src/utils/encryption.ts
 *
 * Verifies AES-256-GCM encrypt/decrypt round-trip, SSN hashing (deterministic),
 * and PII masking helpers — all without database dependencies.
 *
 * PCI-DSS / compliance note: these tests never log or store real SSNs or card numbers.
 */

import { encrypt, decrypt, hashSSN, maskSSN, maskCardNumber } from "../utils/encryption";

describe("encrypt / decrypt", () => {
  it("round-trips arbitrary plaintext", () => {
    const plaintext = "Hello, World!";
    const ciphertext = encrypt(plaintext);
    expect(decrypt(ciphertext)).toBe(plaintext);
  });

  it("produces different ciphertext each call (random IV)", () => {
    const plaintext = "same-input";
    const c1 = encrypt(plaintext);
    const c2 = encrypt(plaintext);
    expect(c1).not.toBe(c2);
  });

  it("ciphertext has iv:authTag:data format (two colons)", () => {
    const ciphertext = encrypt("test");
    const parts = ciphertext.split(":");
    expect(parts).toHaveLength(3);
    // iv should be 32 hex chars (16-byte IV)
    expect(parts[0]).toMatch(/^[0-9a-f]+$/i);
    // authTag should be 32 hex chars (16-byte GCM tag)
    expect(parts[1]).toMatch(/^[0-9a-f]+$/i);
  });

  it("round-trips SSN-like string", () => {
    const ssn = "123-45-6789";
    expect(decrypt(encrypt(ssn))).toBe(ssn);
  });

  it("round-trips date of birth string", () => {
    const dob = "1985-07-22";
    expect(decrypt(encrypt(dob))).toBe(dob);
  });

  it("throws on tampered ciphertext", () => {
    const ciphertext = encrypt("sensitive");
    const [iv, tag, data] = ciphertext.split(":");
    // Corrupt the last byte to a *guaranteed-different* value — forcing "ff"
    // is a no-op the ~1/256 of the time the ciphertext already ends in "ff".
    const tampered = `${iv}:${tag}:${data.slice(0, -2)}${data.endsWith("ff") ? "00" : "ff"}`;
    expect(() => decrypt(tampered)).toThrow();
  });
});

describe("hashSSN", () => {
  it("returns a 64-char hex string (SHA-256)", () => {
    const hash = hashSSN("123456789");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic — same SSN always produces same hash", () => {
    expect(hashSSN("123456789")).toBe(hashSSN("123456789"));
  });

  it("different SSNs produce different hashes", () => {
    expect(hashSSN("123456789")).not.toBe(hashSSN("987654321"));
  });

  it("is non-reversible — output is not the input", () => {
    const ssn = "123456789";
    expect(hashSSN(ssn)).not.toBe(ssn);
  });
});

describe("maskSSN", () => {
  it("masks first 5 digits, shows last 4", () => {
    expect(maskSSN("123456789")).toBe("***-**-6789");
  });

  it("handles hyphenated SSN format", () => {
    expect(maskSSN("123-45-6789")).toBe("***-**-6789");
  });

  it("returns placeholder for non-9-digit input", () => {
    expect(maskSSN("1234")).toBe("***-**-****");
    expect(maskSSN("")).toBe("***-**-****");
  });
});

describe("maskCardNumber", () => {
  it("masks all but last 4 digits of a 16-digit card", () => {
    expect(maskCardNumber("4111111111111234")).toBe("****-****-****-1234");
  });

  it("handles card numbers with spaces", () => {
    expect(maskCardNumber("4111 1111 1111 1234")).toBe("****-****-****-1234");
  });

  it("handles card numbers with dashes", () => {
    expect(maskCardNumber("4111-1111-1111-1234")).toBe("****-****-****-1234");
  });

  it("returns placeholder for very short input", () => {
    expect(maskCardNumber("123")).toBe("****");
  });
});
