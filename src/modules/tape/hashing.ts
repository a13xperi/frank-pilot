/**
 * BP-02 Compliance Tape — hashing primitives.
 *
 * Contract file: pure functions only, no IO. Lane B imports these to build
 * each new entry's hash; Lane F's property tests replay the same code to
 * verify the chain. Do not change the canonicalization or the digest input
 * format without bumping the schema version in docs/bp-02-contracts.md.
 *
 * Digest input format (concatenated, no separators):
 *   sequence (8 bytes, big-endian uint64)
 *   prevHash (32 bytes, raw SHA-256 of previous entry)
 *   canonicalJson(payload) (UTF-8 bytes)
 *   createdAt (UTF-8 bytes of ISO-8601 string with millis + Z)
 *
 * Genesis (sequence=1): prevHash = 32 zero bytes.
 */
import { createHash } from "crypto";
import type { HashChainLink, TapeJsonLdPayload } from "./types";

/** 32-byte buffer of zeros — the prevHash for the first entry in a scope. */
export const GENESIS_HASH: Buffer = Buffer.alloc(32);

/** RFC 8785-ish canonical JSON: keys sorted lexicographically at every depth,
 *  no whitespace, JS-native number serialization. Arrays preserve order.
 *
 *  We intentionally do NOT implement full RFC 8785 (no special number
 *  handling, no JSON-LD canonicalization). For v1, sorted keys + no whitespace
 *  is enough — every payload field is created by Lane C makers under our
 *  control. If we ever accept caller-controlled payloads, revisit this. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, canonicalReplacer(value));
}

function canonicalReplacer(root: unknown): (key: string, val: unknown) => unknown {
  return function (_key, val) {
    if (val === null || typeof val !== "object") return val;
    if (Array.isArray(val)) return val;
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(val as Record<string, unknown>).sort()) {
      sorted[k] = (val as Record<string, unknown>)[k];
    }
    return sorted;
  };
}

/** Pack a JS number sequence as 8 bytes big-endian uint64. JS numbers are safe
 *  up to 2^53, well above any tape we'll see in v1. */
function sequenceToBytes(sequence: number): Buffer {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error(`sequence must be a positive integer, got ${sequence}`);
  }
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(sequence));
  return buf;
}

/** Compute the SHA-256 entry hash. Returns the raw 32-byte Buffer; callers
 *  format as hex (`buf.toString('hex')`) or store as bytea. */
export function computeEntryHash(link: HashChainLink): Buffer {
  if (link.prevHash.length !== 32) {
    throw new Error(`prevHash must be 32 bytes, got ${link.prevHash.length}`);
  }
  const hash = createHash("sha256");
  hash.update(sequenceToBytes(link.sequence));
  hash.update(link.prevHash);
  hash.update(canonicalJson(link.payload), "utf8");
  hash.update(link.createdAt, "utf8");
  return hash.digest();
}

/** Helper for routes/viewers: hex → 32-byte Buffer. Throws on bad input. */
export function hashFromHex(hex: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(`expected 64-char hex hash, got "${hex}"`);
  }
  return Buffer.from(hex, "hex");
}

/** Helper for service/routes: 32-byte Buffer → 64-char lowercase hex. */
export function hashToHex(buf: Buffer): string {
  if (buf.length !== 32) {
    throw new Error(`expected 32-byte buffer, got ${buf.length}`);
  }
  return buf.toString("hex");
}

/** Convenience: build the payload object that gets canonicalized + hashed.
 *  Lane C may construct this directly, but exposing the type-narrowing helper
 *  here keeps the contract obvious. */
export function payloadForHash<T extends TapeJsonLdPayload>(payload: T): T {
  return payload;
}
