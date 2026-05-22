/**
 * Webhook tests for src/modules/payment/webhook.ts.
 *
 * Signature path: we use `stripe.webhooks.generateTestHeaderString` against a
 * known fixture secret to produce the same kind of signed header Stripe sends.
 * The route then calls `constructEvent` against the same secret — verification
 * either passes or fails depending on what we tampered with.
 *
 * To keep the test deterministic the router-internal Stripe client is wired to
 * a Stripe instance instantiated with a non-placeholder fake key so we can call
 * `webhooks.constructEvent` for real. We mock the ledger service and DB layer
 * — those are the side-effects we want to assert on.
 *
 * Mount order: the webhook router installs its own `express.raw` body parser.
 * The test app does NOT install `express.json()`, mirroring the production
 * order in src/index.ts: webhook MUST sit before json().
 */

import express from "express";
import request from "supertest";
import Stripe from "stripe";

// ── Mocks (must be declared before module imports) ─────────────────────────

jest.mock("../config/database", () => ({ query: jest.fn(), transaction: jest.fn() }));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockStampTape = jest.fn().mockResolvedValue(null);
jest.mock("../modules/tape", () => {
  const real = jest.requireActual("../modules/tape");
  return {
    ...real,
    stampTape: mockStampTape,
  };
});

const mockRecordPayment = jest.fn();
jest.mock("../modules/ledger/service", () => ({
  LedgerService: jest.fn().mockImplementation(() => ({
    recordPayment: mockRecordPayment,
  })),
}));

// Real Stripe SDK for signature signing + verification round-trip. We pin a
// fake-but-non-placeholder key so getStripe() inside the router doesn't throw,
// and inject the same one into both halves of the test.
const FAKE_KEY = "sk_test_signing_only_does_not_call_api";
const WEBHOOK_SECRET = "whsec_test_fixture_secret_abcdef";
const stripe = new Stripe(FAKE_KEY, { apiVersion: "2025-02-24.acacia" as Stripe.LatestApiVersion });

jest.mock("../lib/stripe", () => {
  // The router imports getStripe() lazily; we return the real instance built
  // above so `stripe.webhooks.constructEvent` does the real HMAC check.
  return {
    getStripe: () => stripe,
  };
});

import { query } from "../config/database";
import webhookRouter from "../modules/payment/webhook";

const mockQuery = query as jest.MockedFunction<typeof query>;

// ── Build test app ─────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  // NOTE: no app.use(express.json()) — mirrors prod ordering. The webhook
  // router installs its own express.raw() parser internally.
  app.use("/webhook", webhookRouter);
  return app;
}

const app = buildApp();

// ── Test fixtures ──────────────────────────────────────────────────────────

const APP_ID = "11111111-2222-3333-4444-555555555555";

function paymentIntentSucceededEvent(opts: { id?: string; intentId?: string } = {}) {
  return {
    id: opts.id ?? "evt_test_001",
    object: "event",
    api_version: "2025-02-24.acacia",
    created: Math.floor(Date.now() / 1000),
    type: "payment_intent.succeeded",
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    data: {
      object: {
        id: opts.intentId ?? "pi_test_001",
        object: "payment_intent",
        amount: 12500,
        amount_received: 12500,
        currency: "usd",
        status: "succeeded",
        metadata: { applicationId: APP_ID, attemptN: "1", actorId: "user-applicant-001" },
      },
    },
  };
}

function paymentIntentFailedEvent() {
  return {
    id: "evt_test_failed_001",
    object: "event",
    api_version: "2025-02-24.acacia",
    created: Math.floor(Date.now() / 1000),
    type: "payment_intent.payment_failed",
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    data: {
      object: {
        id: "pi_test_failed_001",
        object: "payment_intent",
        amount: 12500,
        amount_received: 0,
        currency: "usd",
        status: "requires_payment_method",
        last_payment_error: { code: "card_declined", message: "Your card was declined." },
        metadata: { applicationId: APP_ID, attemptN: "1", actorId: "user-applicant-001" },
      },
    },
  };
}

function signedHeader(payload: string, secret: string = WEBHOOK_SECRET): string {
  return stripe.webhooks.generateTestHeaderString({ payload, secret });
}

// ── Env wiring ─────────────────────────────────────────────────────────────

const originalEnv = process.env.STRIPE_WEBHOOK_SECRET;
beforeAll(() => {
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
});
afterAll(() => {
  process.env.STRIPE_WEBHOOK_SECRET = originalEnv;
});

beforeEach(() => {
  jest.clearAllMocks();
});

// ── Config refusal ─────────────────────────────────────────────────────────

describe("POST /webhook — config refusal", () => {
  it("returns 503 when STRIPE_WEBHOOK_SECRET is the .env.example placeholder", async () => {
    const saved = process.env.STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_changeme";
    try {
      const res = await request(app)
        .post("/webhook")
        .set("Content-Type", "application/json")
        .send("{}");
      expect(res.status).toBe(503);
      expect(res.body.error).toMatch(/webhook secret not configured/i);
    } finally {
      process.env.STRIPE_WEBHOOK_SECRET = saved;
    }
  });

  it("returns 503 when STRIPE_WEBHOOK_SECRET is empty", async () => {
    const saved = process.env.STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_WEBHOOK_SECRET = "";
    try {
      const res = await request(app)
        .post("/webhook")
        .set("Content-Type", "application/json")
        .send("{}");
      expect(res.status).toBe(503);
    } finally {
      process.env.STRIPE_WEBHOOK_SECRET = saved;
    }
  });
});

// ── Signature verification ─────────────────────────────────────────────────

describe("POST /webhook — signature verification", () => {
  it("returns 400 when stripe-signature header is missing", async () => {
    const payload = JSON.stringify(paymentIntentSucceededEvent());
    const res = await request(app)
      .post("/webhook")
      .set("Content-Type", "application/json")
      .send(payload);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/missing stripe-signature/i);
  });

  it("returns 400 when the signature is forged with the wrong secret", async () => {
    const payload = JSON.stringify(paymentIntentSucceededEvent());
    const badSig = signedHeader(payload, "whsec_a_different_secret_value");

    const res = await request(app)
      .post("/webhook")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", badSig)
      .send(payload);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid signature/i);
    // No DB writes when signature verification fails.
    expect(mockRecordPayment).not.toHaveBeenCalled();
    expect(mockStampTape).not.toHaveBeenCalled();
  });

  it("returns 400 when the body has been tampered with after signing", async () => {
    const original = JSON.stringify(paymentIntentSucceededEvent());
    const sig = signedHeader(original);
    const tampered = original.replace('"amount":12500', '"amount":99999');

    const res = await request(app)
      .post("/webhook")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", sig)
      .send(tampered);

    expect(res.status).toBe(400);
  });
});

// ── Happy path: payment_intent.succeeded ──────────────────────────────────

describe("POST /webhook — payment_intent.succeeded", () => {
  it("posts to ledger, marks idempotency row, stamps tape, records processed_event, returns 200", async () => {
    const event = paymentIntentSucceededEvent();
    const payload = JSON.stringify(event);
    const sig = signedHeader(payload);

    // alreadyProcessed: SELECT 1 → no row.
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);
    // recordPayment is mocked; returns a synthetic ledger entry.
    mockRecordPayment.mockResolvedValue({ id: "led-001", applicationId: APP_ID });
    // markStatus: UPDATE payment_idempotency.
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);
    // writeAuditLog: INSERT audit_log.
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);
    // markProcessed: INSERT stripe_processed_events.
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);

    const res = await request(app)
      .post("/webhook")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", sig)
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);

    expect(mockRecordPayment).toHaveBeenCalledWith(
      APP_ID,
      125, // 12500 cents → $125.00
      "pi_test_001",
      "stripe-webhook",
      "system",
      expect.stringContaining("pi_test_001")
    );
    expect(mockStampTape).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "BP08_PAYMENT_SUCCEEDED",
        sessionId: `pi:${APP_ID}:1`,
      })
    );
    // 4 DB calls: alreadyProcessed, markStatus, audit, markProcessed.
    expect(mockQuery).toHaveBeenCalledTimes(4);
  });

  it("short-circuits to 200 with no side effects when event_id was already processed", async () => {
    const event = paymentIntentSucceededEvent({ id: "evt_dup_001" });
    const payload = JSON.stringify(event);
    const sig = signedHeader(payload);

    // alreadyProcessed: SELECT 1 → row exists.
    mockQuery.mockResolvedValueOnce({ rows: [{ "?column?": 1 }] } as any);

    const res = await request(app)
      .post("/webhook")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", sig)
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.duplicate).toBe(true);

    expect(mockRecordPayment).not.toHaveBeenCalled();
    expect(mockStampTape).not.toHaveBeenCalled();
    // Only the alreadyProcessed lookup ran — no markStatus, no audit, no markProcessed.
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});

// ── payment_intent.payment_failed ──────────────────────────────────────────

describe("POST /webhook — payment_intent.payment_failed", () => {
  it("marks idempotency row failed, stamps tape, returns 200 (no ledger write)", async () => {
    const event = paymentIntentFailedEvent();
    const payload = JSON.stringify(event);
    const sig = signedHeader(payload);

    mockQuery.mockResolvedValueOnce({ rows: [] } as any); // alreadyProcessed
    mockQuery.mockResolvedValueOnce({ rows: [] } as any); // markStatus
    mockQuery.mockResolvedValueOnce({ rows: [] } as any); // writeAuditLog
    mockQuery.mockResolvedValueOnce({ rows: [] } as any); // markProcessed

    const res = await request(app)
      .post("/webhook")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", sig)
      .send(payload);

    expect(res.status).toBe(200);
    expect(mockRecordPayment).not.toHaveBeenCalled();
    expect(mockStampTape).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "BP08_PAYMENT_FAILED",
        payload: expect.objectContaining({
          failureCode: "card_declined",
          failureMessage: "Your card was declined.",
        }),
      })
    );
  });
});

// ── Unknown event type ─────────────────────────────────────────────────────

describe("POST /webhook — unknown event", () => {
  it("returns 200 with no side effects for an event we do not handle", async () => {
    const event = {
      id: "evt_ignored_001",
      object: "event",
      api_version: "2025-02-24.acacia",
      created: Math.floor(Date.now() / 1000),
      type: "customer.subscription.created",
      livemode: false,
      pending_webhooks: 1,
      request: { id: null, idempotency_key: null },
      data: { object: { id: "sub_001", object: "subscription", metadata: {} } },
    };
    const payload = JSON.stringify(event);
    const sig = signedHeader(payload);

    mockQuery.mockResolvedValueOnce({ rows: [] } as any); // alreadyProcessed
    mockQuery.mockResolvedValueOnce({ rows: [] } as any); // markProcessed

    const res = await request(app)
      .post("/webhook")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", sig)
      .send(payload);

    expect(res.status).toBe(200);
    expect(mockRecordPayment).not.toHaveBeenCalled();
    expect(mockStampTape).not.toHaveBeenCalled();
  });
});

// ── DLQ on dispatch failure ────────────────────────────────────────────────

describe("POST /webhook — dispatch failure → DLQ", () => {
  it("inserts into stripe_webhook_dlq and still returns 200 (never 5xx Stripe)", async () => {
    const event = paymentIntentSucceededEvent({ id: "evt_dlq_001" });
    const payload = JSON.stringify(event);
    const sig = signedHeader(payload);

    // alreadyProcessed: no.
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);
    // recordPayment throws — simulates ledger/DB outage.
    mockRecordPayment.mockRejectedValue(new Error("ledger DB connection lost"));
    // recordDlq: INSERT into stripe_webhook_dlq.
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);

    const res = await request(app)
      .post("/webhook")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", sig)
      .send(payload);

    expect(res.status).toBe(200);

    // Assert the DLQ insert happened — the second mockQuery call, with the DLQ SQL.
    const dlqCall = mockQuery.mock.calls.find((c) =>
      String(c[0]).includes("stripe_webhook_dlq")
    );
    expect(dlqCall).toBeDefined();

    // The stripe_processed_events INSERT must NOT happen when dispatch failed
    // — otherwise a replay after the operator fixes the bug would be silently
    // suppressed. (The alreadyProcessed lookup is a SELECT against the same
    // table and does happen; we filter to INSERT only.)
    const processedInsertCall = mockQuery.mock.calls.find((c) => {
      const sql = String(c[0]);
      return sql.includes("stripe_processed_events") && /INSERT/i.test(sql);
    });
    expect(processedInsertCall).toBeUndefined();
  });
});
