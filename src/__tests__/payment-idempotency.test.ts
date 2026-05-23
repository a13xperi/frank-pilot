/**
 * Unit tests for the pure decision helper in src/modules/payment/idempotency.ts.
 *
 * `decide()` is the entire spec-§4.1 lookup-table for idempotency, expressed as
 * a function. We test all four outcomes here and leave the DB-touching helpers
 * (lookup, insertPending, markStatus) to integration coverage in payment-intents
 * and payment-webhook tests.
 */

import {
  buildIdempotencyKey,
  decide,
  IdempotencyRow,
} from "../modules/payment/idempotency";

function fixtureRow(overrides: Partial<IdempotencyRow> = {}): IdempotencyRow {
  return {
    idempotencyKey: "pi:app-001:1",
    applicationId: "app-001",
    attemptN: 1,
    status: "pending",
    paymentIntentId: "pi_test_123",
    clientSecret: "pi_test_123_secret_abc",
    amountCents: 12500,
    currency: "usd",
    lastEventAt: null,
    createdAt: new Date("2026-05-22T00:00:00Z"),
    ...overrides,
  };
}

describe("buildIdempotencyKey", () => {
  it("produces pi:<applicationId>:<attemptN>", () => {
    expect(buildIdempotencyKey("abc-123", 1)).toBe("pi:abc-123:1");
    expect(buildIdempotencyKey("ffff-0000", 42)).toBe("pi:ffff-0000:42");
  });

  it("does not coerce or truncate the application id", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    expect(buildIdempotencyKey(uuid, 7)).toBe(`pi:${uuid}:7`);
  });
});

describe("decide", () => {
  it("returns kind=create when no row exists yet", () => {
    expect(decide(null)).toEqual({ kind: "create" });
  });

  it("returns kind=replay for a pending row (client retried mid-flow)", () => {
    const row = fixtureRow({ status: "pending" });
    const result = decide(row);
    expect(result.kind).toBe("replay");
    if (result.kind !== "replay") throw new Error("type narrowing");
    expect(result.row).toBe(row);
    expect(result.row.clientSecret).toBe("pi_test_123_secret_abc");
  });

  it("returns kind=blocked + reason=succeeded for a terminal-succeeded row", () => {
    const row = fixtureRow({ status: "succeeded" });
    const result = decide(row);
    expect(result.kind).toBe("blocked");
    if (result.kind !== "blocked") throw new Error("type narrowing");
    expect(result.reason).toBe("succeeded");
    expect(result.row).toBe(row);
  });

  it("returns kind=blocked + reason=failed for a terminal-failed row", () => {
    const row = fixtureRow({ status: "failed" });
    const result = decide(row);
    expect(result.kind).toBe("blocked");
    if (result.kind !== "blocked") throw new Error("type narrowing");
    expect(result.reason).toBe("failed");
    expect(result.row).toBe(row);
  });
});
