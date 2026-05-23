/**
 * Tests for src/utils/logger.ts — specifically the piiFilterFormat winston
 * format that walks metadata via sanitizeObject.
 *
 * Closes LOW-1 (SECURITY-AUDIT-2026-05-21): metadata containing `email`,
 * `phone`, etc. used to be JSON-serialized into logs/combined.log unredacted.
 * The structural fix wires sanitizeObject into the winston format chain so
 * the redaction happens once for every logger call, regardless of call site.
 *
 * Approach: build a fresh logger with the same format chain as the configured
 * one plus a CaptureTransport, so we observe the post-format `info` object
 * that File transports would serialize to disk. This is the closest possible
 * approximation to the on-disk log line without spamming actual files.
 *
 * Winston's stream pipeline is async, so each test awaits the logger's
 * "data" event from the CaptureTransport before asserting.
 */

import winston from "winston";
import Transport from "winston-transport";
import { piiFilterFormat } from "../logger";

// ── Capture transport ─────────────────────────────────────────────────────────

class CaptureTransport extends Transport {
  public lines: Record<string, unknown>[] = [];
  log(info: Record<string, unknown>, callback: () => void): void {
    // winston's File transport serializes `info` to JSON after the format
    // chain runs. By the time `info` reaches a transport, all formats have
    // mutated it. So capturing it here is what hits disk.
    this.lines.push(info);
    this.emit("logged", info);
    callback();
  }
}

function buildTestLogger(): { logger: winston.Logger; capture: CaptureTransport } {
  const capture = new CaptureTransport();
  const logger = winston.createLogger({
    level: "info",
    // Same format chain shape as src/utils/logger.ts production logger.
    format: winston.format.combine(
      piiFilterFormat(),
      winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
      winston.format.errors({ stack: true }),
      winston.format.json()
    ),
    defaultMeta: { service: "frank-pilot-test" },
    transports: [capture],
  });
  return { logger, capture };
}

function logAndWait(
  logger: winston.Logger,
  capture: CaptureTransport,
  fn: () => void
): Promise<void> {
  return new Promise((resolve) => {
    capture.once("logged", () => resolve());
    fn();
  });
}

describe("logger PII redaction (LOW-1)", () => {
  it("redacts email key in metadata (the original audit offender shape)", async () => {
    const { logger, capture } = buildTestLogger();

    await logAndWait(logger, capture, () =>
      logger.info("Magic link issued", {
        email: "alex@example.com",
        link: "https://app/auth?token=[REDACTED]",
      })
    );

    expect(capture.lines).toHaveLength(1);
    const line = capture.lines[0];
    expect(line.email).toBe("[REDACTED]");
    // Non-PII metadata pass-through.
    expect(line.link).toBe("https://app/auth?token=[REDACTED]");
    // Winston structural fields preserved.
    expect(line.message).toBe("Magic link issued");
    expect(line.level).toBe("info");
    expect(line.service).toBe("frank-pilot-test");
  });

  it("redacts phone key in metadata", async () => {
    const { logger, capture } = buildTestLogger();

    await logAndWait(logger, capture, () =>
      logger.info("Adverse action notice", { phone: "555-123-4567", noticeId: "abc" })
    );

    expect(capture.lines).toHaveLength(1);
    expect(capture.lines[0].phone).toBe("[REDACTED]");
    expect(capture.lines[0].noticeId).toBe("abc");
  });

  it("redacts ssn key in metadata", async () => {
    const { logger, capture } = buildTestLogger();

    await logAndWait(logger, capture, () =>
      logger.info("screening event", { ssn: "111-22-3333", applicationId: "app-1" })
    );

    expect(capture.lines).toHaveLength(1);
    expect(capture.lines[0].ssn).toBe("[REDACTED]");
    expect(capture.lines[0].applicationId).toBe("app-1");
  });

  it("still runs filterPII on the message string (regression guard)", async () => {
    const { logger, capture } = buildTestLogger();

    await logAndWait(logger, capture, () =>
      logger.info("contact applicant at alex@example.com today", {})
    );

    expect(capture.lines).toHaveLength(1);
    const msg = capture.lines[0].message as string;
    expect(msg).toContain("[EMAIL-REDACTED]");
    expect(msg).not.toContain("alex@example.com");
  });

  it("walks nested metadata objects", async () => {
    const { logger, capture } = buildTestLogger();

    await logAndWait(logger, capture, () =>
      logger.info("user event", {
        user: { email: "foo@bar.com", id: "user-123" },
        action: "login",
      })
    );

    expect(capture.lines).toHaveLength(1);
    const user = capture.lines[0].user as Record<string, unknown>;
    expect(user.email).toBe("[REDACTED]");
    expect(user.id).toBe("user-123");
    expect(capture.lines[0].action).toBe("login");
  });

  it("leaves non-PII fields untouched (no over-redaction)", async () => {
    const { logger, capture } = buildTestLogger();

    await logAndWait(logger, capture, () =>
      logger.info("ordinary event", {
        userId: "u-1",
        role: "applicant",
        attempt: 3,
        normalField: "kept",
      })
    );

    expect(capture.lines).toHaveLength(1);
    const line = capture.lines[0];
    expect(line.userId).toBe("u-1");
    expect(line.role).toBe("applicant");
    expect(line.attempt).toBe(3);
    expect(line.normalField).toBe("kept");
  });

  it("redacts password and token keys in metadata", async () => {
    const { logger, capture } = buildTestLogger();

    await logAndWait(logger, capture, () =>
      logger.info("auth event", {
        password: "hunter2",
        token: "jwt-abc",
        requestId: "req-1",
      })
    );

    expect(capture.lines).toHaveLength(1);
    expect(capture.lines[0].password).toBe("[REDACTED]");
    expect(capture.lines[0].token).toBe("[REDACTED]");
    expect(capture.lines[0].requestId).toBe("req-1");
  });

  it("redacts jwt and cvv keys (Opus REQUEST_CHANGES on PR #101)", async () => {
    const { logger, capture } = buildTestLogger();

    await logAndWait(logger, capture, () =>
      logger.info("payment event", {
        jwt: "eyJhbGciOiJIUzI1NiJ9.payload.sig",
        cvv: "123",
        amount: 50,
      })
    );

    expect(capture.lines).toHaveLength(1);
    expect(capture.lines[0].jwt).toBe("[REDACTED]");
    expect(capture.lines[0].cvv).toBe("[REDACTED]");
    expect(capture.lines[0].amount).toBe(50);
  });

  it("matches PII keys case-insensitively (Email, SSN, DOB uppercase)", async () => {
    const { logger, capture } = buildTestLogger();

    await logAndWait(logger, capture, () =>
      logger.info("mixed-case event", {
        Email: "Alex@Example.com",
        SSN: "111-22-3333",
        DOB: "1990-01-01",
        UserID: "u-1",
      })
    );

    expect(capture.lines).toHaveLength(1);
    expect(capture.lines[0].Email).toBe("[REDACTED]");
    expect(capture.lines[0].SSN).toBe("[REDACTED]");
    expect(capture.lines[0].DOB).toBe("[REDACTED]");
    expect(capture.lines[0].UserID).toBe("u-1");
  });

  it("recurses into 3-level-deep nested metadata", async () => {
    const { logger, capture } = buildTestLogger();

    await logAndWait(logger, capture, () =>
      logger.info("deep event", {
        outer: {
          middle: {
            inner: { email: "deep@example.com", id: "x-1" },
          },
        },
      })
    );

    expect(capture.lines).toHaveLength(1);
    const middle = (capture.lines[0].outer as Record<string, unknown>).middle as Record<string, unknown>;
    const inner = middle.inner as Record<string, unknown>;
    expect(inner.email).toBe("[REDACTED]");
    expect(inner.id).toBe("x-1");
  });

  it("walks array elements and redacts PII inside them (PR #135 follow-up)", async () => {
    // sanitizeObject now recurses into arrays (the 5th gap flagged during
    // PR #135). Element-level PII is redacted just like flat-object PII.
    const { logger, capture } = buildTestLogger();

    await logAndWait(logger, capture, () =>
      logger.info("batch event", {
        recipients: [{ email: "leaks@example.com" }],
      })
    );

    expect(capture.lines).toHaveLength(1);
    const recipients = capture.lines[0].recipients as Array<Record<string, unknown>>;
    // Element-level email is now redacted.
    expect(recipients[0].email).toBe("[REDACTED]");
  });
});
