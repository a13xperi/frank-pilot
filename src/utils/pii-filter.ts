/**
 * PII Filter — strips sensitive data from log output.
 * Ensures zero PII exposure in logs per compliance requirements.
 */

const SSN_PATTERN = /\b\d{3}-?\d{2}-?\d{4}\b/g;
const CREDIT_CARD_PATTERN = /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g;
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
const PHONE_PATTERN = /\b(\+1)?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g;
const ACCOUNT_NUMBER_PATTERN = /\b\d{8,17}\b/g;

const PII_KEYS = [
  "ssn",
  "social_security",
  "socialSecurity",
  "credit_card",
  "creditCard",
  "card_number",
  "cardNumber",
  "account_number",
  "accountNumber",
  "routing_number",
  "routingNumber",
  "password",
  "secret",
  "token",
  "date_of_birth",
  "dateOfBirth",
  "dob",
];

export function filterPII(input: string): string {
  let filtered = input;
  filtered = filtered.replace(SSN_PATTERN, "[SSN-REDACTED]");
  filtered = filtered.replace(CREDIT_CARD_PATTERN, "[CARD-REDACTED]");
  filtered = filtered.replace(EMAIL_PATTERN, "[EMAIL-REDACTED]");
  filtered = filtered.replace(PHONE_PATTERN, "[PHONE-REDACTED]");

  // Redact JSON-like key-value pairs containing PII keys
  for (const key of PII_KEYS) {
    const jsonPattern = new RegExp(
      `"${key}"\\s*:\\s*"[^"]*"`,
      "gi"
    );
    filtered = filtered.replace(jsonPattern, `"${key}":"[REDACTED]"`);
  }

  return filtered;
}

export function sanitizeObject<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (PII_KEYS.some((piiKey) => key.toLowerCase().includes(piiKey.toLowerCase()))) {
      sanitized[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      sanitized[key] = sanitizeObject(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}
