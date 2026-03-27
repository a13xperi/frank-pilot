/**
 * Tests for src/utils/pii-filter.ts
 *
 * Verifies that sensitive PII patterns are redacted from log strings
 * and sanitized from objects. Critical for FCRA / PCI-DSS compliance:
 * no SSNs, card numbers, emails, or phone numbers should appear in logs.
 */

import { filterPII, sanitizeObject } from "../utils/pii-filter";

describe("filterPII — SSN redaction", () => {
  it("redacts 9-digit SSN without dashes", () => {
    expect(filterPII("SSN: 123456789")).toContain("[SSN-REDACTED]");
  });

  it("redacts hyphenated SSN", () => {
    expect(filterPII("SSN: 123-45-6789")).toContain("[SSN-REDACTED]");
  });

  it("does not redact partial SSN-like numbers that are too short", () => {
    // 8-digit number should not be caught by SSN pattern
    const result = filterPII("ref: 12345678");
    expect(result).not.toContain("[SSN-REDACTED]");
  });
});

describe("filterPII — credit card redaction", () => {
  it("redacts 16-digit card number", () => {
    expect(filterPII("card: 4111111111111234")).toContain("[CARD-REDACTED]");
  });

  it("redacts card number with spaces", () => {
    expect(filterPII("card: 4111 1111 1111 1234")).toContain("[CARD-REDACTED]");
  });

  it("redacts card number with dashes", () => {
    expect(filterPII("card: 4111-1111-1111-1234")).toContain("[CARD-REDACTED]");
  });
});

describe("filterPII — email redaction", () => {
  it("redacts a standard email address", () => {
    expect(filterPII("contact: user@example.com")).toContain("[EMAIL-REDACTED]");
  });

  it("redacts email with subdomain", () => {
    expect(filterPII("from: agent@cdpc.test")).toContain("[EMAIL-REDACTED]");
  });

  it("preserves non-email content around it", () => {
    const result = filterPII("Hello user@example.com goodbye");
    expect(result).toContain("Hello");
    expect(result).toContain("[EMAIL-REDACTED]");
    expect(result).toContain("goodbye");
  });
});

describe("filterPII — phone redaction", () => {
  it("redacts US phone in XXX-XXX-XXXX format", () => {
    expect(filterPII("phone: 702-555-1234")).toContain("[PHONE-REDACTED]");
  });

  it("redacts phone in (XXX) XXX-XXXX format", () => {
    expect(filterPII("tel: (702) 555-1234")).toContain("[PHONE-REDACTED]");
  });
});

describe("filterPII — JSON key redaction", () => {
  it("redacts 'ssn' key values in JSON-like strings", () => {
    const input = '{"ssn": "123-45-6789", "name": "John"}';
    const result = filterPII(input);
    expect(result).toContain('"ssn":"[REDACTED]"');
    expect(result).toContain('"name": "John"');
  });

  it("redacts 'password' key values", () => {
    const input = '{"password": "secretpass"}';
    const result = filterPII(input);
    expect(result).toContain('"password":"[REDACTED]"');
  });

  it("redacts 'date_of_birth' key values", () => {
    const input = '{"date_of_birth": "1985-07-22"}';
    const result = filterPII(input);
    expect(result).toContain('"date_of_birth":"[REDACTED]"');
  });

  it("does not alter non-PII keys", () => {
    const input = '{"status": "approved", "score": "750"}';
    const result = filterPII(input);
    expect(result).toContain('"status": "approved"');
    expect(result).toContain('"score": "750"');
  });
});

describe("sanitizeObject", () => {
  it("redacts top-level PII keys", () => {
    const obj = { ssn: "123-45-6789", name: "Jane Doe" };
    const result = sanitizeObject(obj);
    expect(result.ssn).toBe("[REDACTED]");
    expect(result.name).toBe("Jane Doe");
  });

  it("redacts camelCase PII keys", () => {
    const obj = { dateOfBirth: "1990-01-01", age: 34 };
    const result = sanitizeObject(obj);
    expect(result.dateOfBirth).toBe("[REDACTED]");
    expect(result.age).toBe(34);
  });

  it("recursively sanitizes nested objects", () => {
    const obj = {
      applicant: {
        ssn: "123456789",
        firstName: "Jane",
      },
      status: "pending",
    };
    const result = sanitizeObject(obj);
    const applicant = result.applicant as Record<string, unknown>;
    expect(applicant.ssn).toBe("[REDACTED]");
    expect(applicant.firstName).toBe("Jane");
    expect(result.status).toBe("pending");
  });

  it("does not modify arrays (leaves them as-is)", () => {
    const obj = { tags: ["a", "b"], score: 720 };
    const result = sanitizeObject(obj);
    expect(result.tags).toEqual(["a", "b"]);
  });

  it("redacts keys containing 'token' substring", () => {
    const obj = { accessToken: "abc123", id: "xyz" };
    const result = sanitizeObject(obj);
    expect(result.accessToken).toBe("[REDACTED]");
    expect(result.id).toBe("xyz");
  });

  it("redacts keys containing 'secret' substring", () => {
    const obj = { apiSecret: "very-secret", count: 5 };
    const result = sanitizeObject(obj);
    expect(result.apiSecret).toBe("[REDACTED]");
    expect(result.count).toBe(5);
  });
});
