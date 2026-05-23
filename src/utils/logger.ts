import winston from "winston";
import { filterPII, sanitizeObject } from "./pii-filter";

/**
 * Winston format that redacts PII from both the message string and the
 * metadata object. Closes LOW-1 (SECURITY-AUDIT-2026-05-21): metadata
 * containing `email`, `phone`, etc. was previously JSON-serialized into
 * combined.log unredacted (e.g. `logger.info("Magic link issued", { email })`).
 *
 * Implementation note: sanitizeObject returns a fresh object built from
 * Object.entries, which only walks string keys. Winston internally relies
 * on Symbol-keyed properties (LEVEL, MESSAGE, SPLAT from triple-beam) to
 * route the log line through transports. We therefore mutate `info` in place
 * — overwriting only the string-keyed properties — so the symbol-keyed ones
 * survive the format chain. Without this, transports never receive the line.
 */
export const piiFilterFormat = winston.format((info) => {
  if (typeof info.message === "string") {
    info.message = filterPII(info.message);
  }
  // sanitizeObject walks PII_KEY_PATTERNS (email/phone/ssn/dob/token/etc.),
  // redacts string leaf values that contain PII patterns, and recursively
  // redacts nested objects. Winston's own string keys (level, message,
  // timestamp, service) match no PII pattern so they pass through unchanged.
  const sanitized = sanitizeObject(info as unknown as Record<string, unknown>);
  for (const key of Object.keys(sanitized)) {
    (info as Record<string, unknown>)[key] = sanitized[key];
  }
  return info;
});

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(
    piiFilterFormat(),
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: "frank-pilot" },
  transports: [
    new winston.transports.File({ filename: "logs/error.log", level: "error" }),
    new winston.transports.File({ filename: "logs/combined.log" }),
  ],
});

if (process.env.NODE_ENV !== "production") {
  logger.add(
    new winston.transports.Console({
      format: winston.format.combine(
        piiFilterFormat(),
        winston.format.colorize(),
        winston.format.simple()
      ),
    })
  );
}
