import crypto from "crypto";

/**
 * ElevenLabs HMAC signature verification, shared by:
 *   - voice-intake/webhook.ts        (post-call payloads)
 *   - voice-intake/tool-callbacks.ts (in-call server-tool invocations)
 *
 * Both endpoints sign the raw request body the same way:
 *   HMAC-SHA256(secret, "<timestamp>." + rawBody)
 * sent as the header `ElevenLabs-Signature: t=<ts>,v0=<hex>[,v0=<hex>...]`.
 * Multiple `v0` entries can appear during key rotation; we accept any match.
 */

// 30-minute tolerance for the signed `t=` timestamp. Matches Stripe's default
// and gives ElevenLabs plenty of room for delivery retries while still
// shutting the door on the obvious replay window.
export const SIGNATURE_TIMESTAMP_TOLERANCE_SECS = 30 * 60;

export interface ParsedSignature {
  timestamp: number;
  signatures: string[];
}

export function parseSignatureHeader(header: string): ParsedSignature | null {
  const parts = header.split(",").map((p) => p.trim());
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of parts) {
    const [k, v] = part.split("=");
    if (!k || !v) continue;
    if (k === "t") {
      const n = Number(v);
      if (Number.isFinite(n)) timestamp = n;
    } else if (k === "v0") {
      signatures.push(v);
    }
  }
  if (timestamp == null || signatures.length === 0) return null;
  return { timestamp, signatures };
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

export function computeSignature(
  secret: string,
  timestamp: number,
  rawBody: Buffer
): string {
  const h = crypto.createHmac("sha256", secret);
  h.update(`${timestamp}.`);
  h.update(rawBody);
  return h.digest("hex");
}

export type SignatureVerifyReason =
  | "missing-signature"
  | "malformed-signature"
  | "stale-timestamp"
  | "bad-signature";

export interface SignatureVerifyResult {
  ok: boolean;
  reason?: SignatureVerifyReason;
  /** Set on ok===true; the timestamp from the verified header. */
  timestamp?: number;
}

export function verifySignature(
  rawBody: Buffer,
  signatureHeader: string | string[] | undefined,
  secret: string,
  nowSecs: number
): SignatureVerifyResult {
  if (!signatureHeader || Array.isArray(signatureHeader)) {
    return { ok: false, reason: "missing-signature" };
  }
  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed) return { ok: false, reason: "malformed-signature" };

  if (Math.abs(nowSecs - parsed.timestamp) > SIGNATURE_TIMESTAMP_TOLERANCE_SECS) {
    return { ok: false, reason: "stale-timestamp" };
  }

  const expected = computeSignature(secret, parsed.timestamp, rawBody);
  const match = parsed.signatures.some((sig) => timingSafeEqualHex(sig, expected));
  if (!match) return { ok: false, reason: "bad-signature" };

  return { ok: true, timestamp: parsed.timestamp };
}
