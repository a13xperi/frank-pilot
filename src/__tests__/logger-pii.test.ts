/**
 * Tests for the 4 PII redaction gaps closed in the L1.3 Opus audit
 * (PR #101 follow-up). Covers:
 *   1. string-leaf value redaction in sanitizeObject
 *   2. case-insensitive substring key matching (userEmail, applicantPhone, lastSsn)
 *   3. dead account_number regex removal (key match supersedes it)
 *   4. login error log records err.name only (verified via filterPII/leaf scan)
 */

import {
  filterPII,
  sanitizeObject,
  redactSensitiveStrings,
  PII_KEY_PATTERNS,
} from "../utils/pii-filter";

describe("Gap 1 — sanitizeObject scans string LEAF values", () => {
  it("redacts an email embedded in a non-PII key's string value", () => {
    // The original leak: logger.info("user emailed", { msg: "alice@example.com" })
    const result = sanitizeObject({ msg: "alice@example.com" });
    expect(result.msg).toBe("[EMAIL-REDACTED]");
  });

  it("redacts SSN/phone/card patterns in arbitrary string values", () => {
    const result = sanitizeObject({
      note: "called 702-555-1234 re ssn 123-45-6789",
      ref: "card 4111 1111 1111 1234 on file",
    });
    expect(result.note).toContain("[PHONE-REDACTED]");
    expect(result.note).toContain("[SSN-REDACTED]");
    expect(result.ref).toContain("[CARD-REDACTED]");
  });

  it("redacts string leaves inside nested objects", () => {
    const result = sanitizeObject({
      payload: { detail: "reach me at bob@example.com" },
    });
    const payload = result.payload as Record<string, unknown>;
    expect(payload.detail).toContain("[EMAIL-REDACTED]");
    expect(payload.detail).not.toContain("bob@example.com");
  });

  it("leaves clean string leaves untouched (no over-redaction)", () => {
    const result = sanitizeObject({ status: "approved", note: "looks good" });
    expect(result.status).toBe("approved");
    expect(result.note).toBe("looks good");
  });

  it("does NOT redact UUID-style ids (project convention: not PII)", () => {
    const result = sanitizeObject({
      id: "550e8400-e29b-41d4-a716-446655440000",
      applicationId: "app-123",
      propertyId: "prop-456",
      userId: "u-789",
    });
    expect(result.id).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(result.applicationId).toBe("app-123");
    expect(result.propertyId).toBe("prop-456");
    expect(result.userId).toBe("u-789");
  });
});

describe("Gap 2 — case-insensitive substring key matching", () => {
  it("redacts userEmail / applicantPhone / lastSsn", () => {
    const result = sanitizeObject({
      userEmail: "x@y.com",
      applicantPhone: "555-123-4567",
      lastSsn: "6789",
    });
    expect(result.userEmail).toBe("[REDACTED]");
    expect(result.applicantPhone).toBe("[REDACTED]");
    expect(result.lastSsn).toBe("[REDACTED]");
  });

  it("redacts email_address / customerCreditCard / accountNumber", () => {
    const result = sanitizeObject({
      email_address: "a@b.com",
      customerCreditCard: "4111111111111234",
      accountNumber: "00012345678",
    });
    expect(result.email_address).toBe("[REDACTED]");
    expect(result.customerCreditCard).toBe("[REDACTED]");
    expect(result.accountNumber).toBe("[REDACTED]");
  });

  it("filterPII redacts JSON kv pairs with derived key names", () => {
    const input = '{"userEmail": "x@y.com", "status": "ok"}';
    const result = filterPII(input);
    expect(result).toContain('"userEmail":"[REDACTED]"');
    expect(result).toContain('"status": "ok"');
  });
});

describe("Gap 3 — dead account_number regex removed", () => {
  it("no longer mass-redacts plain 8-17 digit numbers in string values", () => {
    // The old ACCOUNT_NUMBER_PATTERN (/\b\d{8,17}\b/g) would have blanked
    // these. They must survive — they are not PII.
    const result = sanitizeObject({
      orderRef: "12345678",
      timestampMs: "1716384000000",
    });
    expect(result.orderRef).toBe("12345678");
    expect(result.timestampMs).toBe("1716384000000");
  });

  it("account number still redacts via key pattern, not value regex", () => {
    expect(PII_KEY_PATTERNS.some((rx) => rx.test("account_number"))).toBe(true);
    expect(PII_KEY_PATTERNS.some((rx) => rx.test("accountNumber"))).toBe(true);
    const result = sanitizeObject({ account_number: "00012345678" });
    expect(result.account_number).toBe("[REDACTED]");
  });

  it("redactSensitiveStrings does not touch bare long digit runs", () => {
    expect(redactSensitiveStrings("ref 12345678901")).toBe("ref 12345678901");
  });
});

describe("Gap 4 — login error logs err.name only", () => {
  // The route now builds { errorName } from err.name. Even if a careless
  // future change reintroduced err.message with embedded PII, the leaf scan
  // would catch it. Verify both layers.
  it("a name-only payload passes through cleanly", () => {
    const result = sanitizeObject({ errorName: "ValidationError" });
    expect(result.errorName).toBe("ValidationError");
  });

  it("defense-in-depth: a leaked email in an error string is scrubbed", () => {
    const result = sanitizeObject({
      error: "Invalid login for alex@example.com",
    });
    expect(result.error).toContain("[EMAIL-REDACTED]");
    expect(result.error).not.toContain("alex@example.com");
  });
});

describe("Gap 5 — sanitizeObject walks ARRAY elements (PR #135 follow-up)", () => {
  it("redacts an email inside an array of objects", () => {
    const result = sanitizeObject({ recipients: [{ email: "x@y.com" }] });
    const recipients = result.recipients as Array<Record<string, unknown>>;
    expect(recipients[0].email).toBe("[REDACTED]");
  });

  it("fully redacts every string in a PII-keyed array", () => {
    const result = sanitizeObject({ emails: ["a@b.com", "c@d.com"] });
    expect(result.emails).toEqual(["[REDACTED]", "[REDACTED]"]);
  });

  it("scans only PII-shaped strings in a non-PII-keyed array", () => {
    const result = sanitizeObject({ tags: ["normal", "alice@example.com"] });
    expect(result.tags).toEqual(["normal", "[EMAIL-REDACTED]"]);
  });

  it("recurses into nested arrays", () => {
    const result = sanitizeObject({ batches: [[{ ssn: "123-45-6789" }]] });
    const outer = result.batches as unknown[][];
    const inner = outer[0][0] as Record<string, unknown>;
    expect(inner.ssn).toBe("[REDACTED]");
  });

  it("passes through arrays of primitives unchanged", () => {
    const result = sanitizeObject({ counts: [1, 2, 3] });
    expect(result.counts).toEqual([1, 2, 3]);
  });

  it("passes through UUID-ish *Ids / *_ids arrays untouched (not PII)", () => {
    const ids = ["550e8400-e29b-41d4-a716-446655440000"];
    const result = sanitizeObject({ applicationIds: ids, property_ids: ids });
    expect(result.applicationIds).toEqual(ids);
    expect(result.property_ids).toEqual(ids);
  });

  it("does not crash on circular references", () => {
    const obj: Record<string, unknown> = { name: "loop" };
    const arr: unknown[] = [obj];
    obj.self = arr; // arr -> obj -> arr ...
    expect(() => sanitizeObject({ data: arr })).not.toThrow();
  });

  it("caps very large arrays with a truncation marker", () => {
    const big = Array.from({ length: 1500 }, (_, i) => i);
    const result = sanitizeObject({ counts: big });
    const out = result.counts as unknown[];
    expect(out.length).toBe(1001); // 1000 elements + 1 marker
    expect(out[1000]).toBe("[…500 more]");
  });
});
