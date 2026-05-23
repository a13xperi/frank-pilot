/**
 * PII Filter — strips sensitive data from log output.
 * Ensures zero PII exposure in logs per compliance requirements.
 *
 * L1.3 Opus audit follow-up (PR #101 follow-up):
 *   1. sanitizeObject now scans string LEAF values for PII patterns
 *      (email/phone/SSN/credit-card) when the key itself isn't a PII key.
 *   2. Key matching switched from exact-in-list to case-insensitive regex
 *      patterns so `userEmail`, `applicantPhone`, `last_ssn`, `email_address`
 *      all redact.
 *   3. Dead ACCOUNT_NUMBER_PATTERN removed — the key patterns (`account.*number`,
 *      `routing`) supersede it, and applying an 8-17 digit regex to free strings
 *      would over-redact unit numbers, application IDs, timestamps, etc.
 */

const SSN_PATTERN = /\b\d{3}-?\d{2}-?\d{4}\b/g;
const CREDIT_CARD_PATTERN = /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g;
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
const PHONE_PATTERN = /\b(\+1)?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g;

/**
 * PII key patterns — case-insensitive regex match against object keys.
 *
 * Substring match (not full-match) so we catch `userEmail`, `applicantPhone`,
 * `last_ssn`, `email_address`, `customerCreditCard`, etc.
 *
 * Convention: UUIDs (id / applicationId / propertyId / userId) are NOT PII
 * per project decision — only suffix-style PII keys appear here.
 */
export const PII_KEY_PATTERNS: RegExp[] = [
  /email/i,
  /phone/i,
  /ssn/i,
  /social.*security/i,
  /tax.*id/i,
  /\btin\b/i,
  /password/i,
  /secret/i,
  /token/i,
  /\bjwt\b/i,
  /credit.*card/i,
  /card.*number/i,
  /\bcvv\b/i,
  /account.*number/i,
  /routing.*number/i,
  /routing/i,
  /\bdob\b/i,
  /date.*of.*birth/i,
  /birth.*date/i,
];

function keyMatchesPII(key: string): boolean {
  return PII_KEY_PATTERNS.some((rx) => rx.test(key));
}

/**
 * Scan a string value for PII patterns and redact in place.
 * Used by sanitizeObject for string LEAF values whose key isn't a PII key.
 *
 * Scope: log-payload values only. Not applied to top-level `message` (that
 * already goes through filterPII, which uses the same patterns).
 */
export function redactSensitiveStrings(input: string): string {
  let out = input;
  out = out.replace(SSN_PATTERN, "[SSN-REDACTED]");
  out = out.replace(CREDIT_CARD_PATTERN, "[CARD-REDACTED]");
  out = out.replace(EMAIL_PATTERN, "[EMAIL-REDACTED]");
  out = out.replace(PHONE_PATTERN, "[PHONE-REDACTED]");
  return out;
}

export function filterPII(input: string): string {
  let filtered = input;
  filtered = filtered.replace(SSN_PATTERN, "[SSN-REDACTED]");
  filtered = filtered.replace(CREDIT_CARD_PATTERN, "[CARD-REDACTED]");
  filtered = filtered.replace(EMAIL_PATTERN, "[EMAIL-REDACTED]");
  filtered = filtered.replace(PHONE_PATTERN, "[PHONE-REDACTED]");

  // Redact JSON-like key-value pairs whose key matches a PII pattern.
  // Captures the literal key string from the JSON so its case is preserved
  // in the replacement.
  const jsonKvPattern = /"([^"\\]+)"\s*:\s*"[^"]*"/g;
  filtered = filtered.replace(jsonKvPattern, (match, key: string) => {
    return keyMatchesPII(key) ? `"${key}":"[REDACTED]"` : match;
  });

  return filtered;
}

/** Max recursion depth — guards against circular refs / pathological nesting. */
const MAX_DEPTH = 10;
/** Max array elements walked before truncating with a marker. */
const MAX_ARRAY_ELEMENTS = 1000;

/**
 * UUID-ish key convention: `*Ids` / `*_ids` arrays hold UUIDs, which are NOT
 * PII per project decision. Pass these arrays through untouched so we don't
 * over-redact application/property/user ID collections.
 */
function isUuidIdKey(key: string): boolean {
  return /(?:ids|_ids)$/i.test(key);
}

/**
 * Walk an array value. `piiKey` = the array's own key matched a PII pattern,
 * in which case every string element is FULLY redacted (matching how a
 * PII-keyed scalar is redacted today).
 */
function sanitizeArray(arr: unknown[], piiKey: boolean, depth: number): unknown[] {
  if (depth > MAX_DEPTH) return ["[MAX-DEPTH]"];

  const limit = Math.min(arr.length, MAX_ARRAY_ELEMENTS);
  const out: unknown[] = [];
  for (let i = 0; i < limit; i++) {
    const el = arr[i];
    if (Array.isArray(el)) {
      out.push(sanitizeArray(el, piiKey, depth + 1));
    } else if (typeof el === "object" && el !== null) {
      out.push(sanitizeObjectInner(el as Record<string, unknown>, depth + 1));
    } else if (typeof el === "string") {
      out.push(piiKey ? "[REDACTED]" : redactSensitiveStrings(el));
    } else {
      out.push(el);
    }
  }
  if (arr.length > MAX_ARRAY_ELEMENTS) {
    out.push(`[…${arr.length - MAX_ARRAY_ELEMENTS} more]`);
  }
  return out;
}

function sanitizeObjectInner(
  obj: Record<string, unknown>,
  depth: number,
): Record<string, unknown> {
  if (depth > MAX_DEPTH) return { __truncated: "[MAX-DEPTH]" };

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value)) {
      // UUID-ish ID arrays are not PII — pass through untouched.
      if (isUuidIdKey(key)) {
        sanitized[key] = value;
      } else {
        // Fix (PR #135 follow-up): walk array elements. Objects recurse,
        // strings run through redactSensitiveStrings, primitives pass
        // through. PII-keyed arrays (e.g. `emails`) fully redact each string.
        sanitized[key] = sanitizeArray(value, keyMatchesPII(key), depth + 1);
      }
    } else if (keyMatchesPII(key)) {
      sanitized[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      sanitized[key] = sanitizeObjectInner(value as Record<string, unknown>, depth + 1);
    } else if (typeof value === "string") {
      // Fix 1 (L1.3 audit): scan string LEAF values for PII patterns when the
      // key itself isn't PII. Catches shapes like
      //   logger.info("user emailed", { msg: "alice@example.com" })
      // which previously leaked the email into combined.log.
      sanitized[key] = redactSensitiveStrings(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export function sanitizeObject<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  return sanitizeObjectInner(obj, 0);
}
