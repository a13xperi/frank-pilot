/**
 * BP-08 end-to-end payment loop (deterministic, CI-friendly).
 *
 * This is the regression guard for the full client→Stripe→webhook→ledger loop
 * and, specifically, for the Part-1 livemode-guard decoupling (the webhook now
 * keys "expected livemode" off the `sk_test_`/`sk_live_` secret-key prefix, not
 * the `STRIPE_LIVE_ENABLED` flag — so a test-mode deployment can complete a real
 * `livemode:false` loop).
 *
 * Unlike payment-intents.test.ts / payment-webhook.test.ts (which mock `query`
 * per-call), this test wires BOTH the real intents router AND the real webhook
 * router into one app and backs `query` with a small in-memory store keyed on
 * the SQL each module actually runs. So the loop runs for real across module
 * boundaries:
 *
 *   1. POST /api/payments/intents mints a PaymentIntent (Stripe.create mocked to
 *      a known id) and inserts a `pending` payment_idempotency row.
 *   2. POST /api/payments/webhook receives a PROPERLY-SIGNED, test-mode
 *      (`livemode:false`) `payment_intent.succeeded` event for that same intent.
 *   3. The webhook calls ledger.recordPayment (mocked, mutates an in-memory
 *      balance) and transitions the SAME idempotency row pending→succeeded.
 *
 * We assert: idempotency row = succeeded, recordPayment called once, balance
 * dropped by the paid amount, and the event id is recorded for dedupe — then
 * that a duplicate webhook delivery short-circuits without double-posting.
 *
 * Mount order mirrors prod (src/index.ts): webhook router (its own express.raw)
 * BEFORE express.json(), then the intents router.
 */

import express from "express";
import request from "supertest";
import Stripe from "stripe";
import { generateToken, AuthUser } from "../middleware/auth";

// ── Fixtures ────────────────────────────────────────────────────────────────

const APP_ID = "11111111-2222-3333-4444-555555555555";
const INTENT_ID = "pi_test_loop_001";
const CLIENT_SECRET = "pi_test_loop_001_secret_abc";
const EVENT_ID = "evt_test_loop_001";
const AMOUNT_CENTS = 12500;
const AMOUNT_DOLLARS = 125.0;

// Real Stripe SDK instance for signing + verifying the webhook for real. Test
// key (sk_test_) so expectedLivemode() ⇒ false ⇒ matches the livemode:false event.
const FAKE_KEY = "sk_test_signing_only_does_not_call_api";
const WEBHOOK_SECRET = "whsec_test_fixture_secret_abcdef";
const stripe = new Stripe(FAKE_KEY, {
  apiVersion: "2026-05-27.dahlia",
});

const applicant: AuthUser = {
  id: "user-applicant-001",
  email: "tenant@example.com",
  role: "applicant",
  firstName: "Jane",
  lastName: "Doe",
  propertyIds: [],
  emailVerified: true,
};

// ── In-memory store backing the mocked `query` ──────────────────────────────

interface Store {
  users: Map<string, Record<string, unknown>>;
  userApplications: Set<string>; // `${userId}::${applicationId}`
  idempotency: Map<string, Record<string, any>>;
  processedEvents: Set<string>;
  balance: Record<string, number>; // applicationId → dollars
}

const store: Store = {
  users: new Map(),
  userApplications: new Set(),
  idempotency: new Map(),
  processedEvents: new Set(),
  balance: {},
};

function resetStore() {
  store.users.clear();
  store.userApplications.clear();
  store.idempotency.clear();
  store.processedEvents.clear();
  store.balance = { [APP_ID]: AMOUNT_DOLLARS };

  store.users.set(applicant.id, {
    id: applicant.id,
    email: applicant.email,
    role: applicant.role,
    first_name: applicant.firstName,
    last_name: applicant.lastName,
    property_ids: applicant.propertyIds,
    is_active: true,
    email_verified_at: new Date(),
  });
  store.userApplications.add(`${applicant.id}::${APP_ID}`);
}

// ── In-memory `query` dispatcher (wired to the mock after import) ───────────

async function queryImpl(sql: string, params: any[] = []): Promise<any> {
  const s = sql.replace(/\s+/g, " ").trim();

  // authenticate(): SELECT ... FROM users WHERE id = $1
  if (s.startsWith("SELECT id, email, role") && s.includes("FROM users WHERE id")) {
    const u = store.users.get(params[0]);
    return { rows: u ? [u] : [] };
  }
  // callerOwnsApplication(): SELECT 1 FROM user_applications WHERE ...
  if (s.includes("FROM user_applications")) {
    const key = `${params[0]}::${params[1]}`;
    return { rows: store.userApplications.has(key) ? [{ "?column?": 1 }] : [] };
  }
  // idempotency.lookup(): SELECT idempotency_key ... FROM payment_idempotency
  if (s.startsWith("SELECT idempotency_key") && s.includes("FROM payment_idempotency")) {
    const row = store.idempotency.get(params[0]);
    return { rows: row ? [{ ...row }] : [] };
  }
  // idempotency.insertPending(): INSERT INTO payment_idempotency ... ON CONFLICT DO NOTHING
  if (s.startsWith("INSERT INTO payment_idempotency")) {
    const key = params[0];
    if (!store.idempotency.has(key)) {
      store.idempotency.set(key, {
        idempotency_key: key,
        application_id: params[1],
        attempt_n: params[2],
        status: "pending",
        payment_intent_id: params[3],
        client_secret: params[4],
        amount_cents: params[5],
        currency: params[6],
        last_event_at: new Date(),
        created_at: new Date(),
      });
    }
    return { rows: [] };
  }
  // idempotency.markStatus(): UPDATE payment_idempotency SET status=$2 WHERE key=$1 AND status='pending'
  if (s.startsWith("UPDATE payment_idempotency")) {
    const row = store.idempotency.get(params[0]);
    if (row && row.status === "pending") {
      row.status = params[1];
      row.last_event_at = new Date();
    }
    return { rows: [] };
  }
  // webhook.alreadyProcessed(): SELECT 1 FROM stripe_processed_events WHERE event_id = $1
  if (s.startsWith("SELECT 1 FROM stripe_processed_events")) {
    return { rows: store.processedEvents.has(params[0]) ? [{ "?column?": 1 }] : [] };
  }
  // webhook.markProcessed(): INSERT INTO stripe_processed_events ... ON CONFLICT DO NOTHING
  if (s.startsWith("INSERT INTO stripe_processed_events")) {
    store.processedEvents.add(params[0]);
    return { rows: [] };
  }

  // Everything else (audit_log inserts, DLQ probes) — no-op success.
  return { rows: [] };
}

// ── Mocks (must be declared before module imports) ─────────────────────────

jest.mock("../config/database", () => ({ query: jest.fn(), transaction: jest.fn() }));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockStampTape = jest.fn().mockResolvedValue(null);
jest.mock("../modules/tape", () => {
  const real = jest.requireActual("../modules/tape");
  return { ...real, stampTape: mockStampTape };
});

// Intents route mints a known PaymentIntent; webhook route gets the real
// signing Stripe instance so constructEvent does a real HMAC verify.
const mockPaymentIntentsCreate = jest.fn();
jest.mock("../lib/stripe", () => ({
  getStripe: () => {
    // The intents route only touches paymentIntents.create; the webhook route
    // only touches webhooks.constructEvent. One object satisfies both.
    return Object.assign(Object.create(stripe), {
      paymentIntents: { create: mockPaymentIntentsCreate },
    });
  },
  expectedLivemode: () =>
    (process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_live_"),
}));

// Ledger: mutate an in-memory balance so we can assert the delta.
const mockRecordPayment = jest.fn(
  async (applicationId: string, amount: number) => {
    store.balance[applicationId] = (store.balance[applicationId] ?? 0) - amount;
    return { id: "ledger-entry-loop-001", applicationId, amount };
  }
);
jest.mock("../modules/ledger/service", () => ({
  LedgerService: jest.fn().mockImplementation(() => ({
    recordPayment: mockRecordPayment,
  })),
}));

import { query } from "../config/database";
import intentsRouter from "../modules/payment/intents";
import webhookRouter from "../modules/payment/webhook";

const mockQuery = query as jest.MockedFunction<typeof query>;

// ── Test app (prod mount order) ─────────────────────────────────────────────

function buildApp() {
  const app = express();
  // webhook FIRST — it brings its own express.raw() and must see the raw body.
  app.use("/api/payments/webhook", webhookRouter);
  app.use(express.json());
  app.use("/api/payments/intents", intentsRouter);
  return app;
}

const app = buildApp();

function tokenFor(user: AuthUser): string {
  return `Bearer ${generateToken(user)}`;
}

function succeededEvent(opts: { id?: string } = {}) {
  return {
    id: opts.id ?? EVENT_ID,
    object: "event",
    api_version: "2025-02-24.acacia",
    created: Math.floor(Date.now() / 1000),
    type: "payment_intent.succeeded",
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    data: {
      object: {
        id: INTENT_ID,
        object: "payment_intent",
        amount: AMOUNT_CENTS,
        amount_received: AMOUNT_CENTS,
        currency: "usd",
        status: "succeeded",
        metadata: { applicationId: APP_ID, attemptN: "1", actorId: applicant.id },
      },
    },
  };
}

async function postWebhook(event: object) {
  // Sign and send the EXACT same payload string — Stripe's HMAC is over the
  // raw bytes, so the body superagent transmits must match what we signed.
  const payload = JSON.stringify(event);
  const sig = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: WEBHOOK_SECRET,
  });
  return request(app)
    .post("/api/payments/webhook")
    .set("Content-Type", "application/json")
    .set("Stripe-Signature", sig)
    .send(payload);
}

// ── Env ──────────────────────────────────────────────────────────────────────

const savedSecretKey = process.env.STRIPE_SECRET_KEY;
const savedWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

beforeAll(() => {
  process.env.STRIPE_SECRET_KEY = FAKE_KEY; // sk_test_ ⇒ expectedLivemode() false
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
});

afterAll(() => {
  if (savedSecretKey === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = savedSecretKey;
  if (savedWebhookSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
  else process.env.STRIPE_WEBHOOK_SECRET = savedWebhookSecret;
});

beforeEach(() => {
  jest.clearAllMocks();
  resetStore();
  mockQuery.mockImplementation(queryImpl as any);
  mockPaymentIntentsCreate.mockResolvedValue({
    id: INTENT_ID,
    client_secret: CLIENT_SECRET,
  });
});

// ── The loop ──────────────────────────────────────────────────────────────────

describe("BP-08 payment loop — mint intent → signed test-mode webhook → ledger", () => {
  it("completes the full loop: pending row → succeeded, balance drops, dedupe recorded", async () => {
    // 1. Client mints the PaymentIntent.
    const mintRes = await request(app)
      .post("/api/payments/intents")
      .set("Authorization", tokenFor(applicant))
      .send({ applicationId: APP_ID, amountCents: AMOUNT_CENTS, attemptN: 1 });

    expect(mintRes.status).toBe(201);
    expect(mintRes.body.clientSecret).toBe(CLIENT_SECRET);
    expect(mintRes.body.paymentIntentId).toBe(INTENT_ID);
    expect(mintRes.body.idempotencyKey).toBe(`pi:${APP_ID}:1`);

    // Pending row persisted, balance untouched until the webhook confirms.
    expect(store.idempotency.get(`pi:${APP_ID}:1`)?.status).toBe("pending");
    expect(store.balance[APP_ID]).toBe(AMOUNT_DOLLARS);

    // 2. Stripe confirms via a real-signed, test-mode webhook.
    const hookRes = await postWebhook(succeededEvent());
    expect(hookRes.status).toBe(200);
    expect(hookRes.body).toEqual({ received: true });

    // 3. Loop closed: row terminal, ledger posted once, balance reduced.
    expect(store.idempotency.get(`pi:${APP_ID}:1`)?.status).toBe("succeeded");
    expect(mockRecordPayment).toHaveBeenCalledTimes(1);
    expect(mockRecordPayment).toHaveBeenCalledWith(
      APP_ID,
      AMOUNT_DOLLARS,
      INTENT_ID,
      // System-initiated by the webhook: no user actor. postedBy/postedByRole
      // are null so they land as NULL in the nullable posted_by (uuid) /
      // audit actor columns — "stripe-webhook"/"system" are not a uuid/enum.
      null,
      null,
      `Stripe PaymentIntent ${INTENT_ID}`
    );
    expect(store.balance[APP_ID]).toBe(0);
    expect(store.processedEvents.has(EVENT_ID)).toBe(true);
  });

  it("is idempotent: a duplicate webhook delivery short-circuits without double-posting", async () => {
    await request(app)
      .post("/api/payments/intents")
      .set("Authorization", tokenFor(applicant))
      .send({ applicationId: APP_ID, amountCents: AMOUNT_CENTS, attemptN: 1 });

    const first = await postWebhook(succeededEvent());
    expect(first.status).toBe(200);
    expect(first.body.duplicate).toBeUndefined();

    const second = await postWebhook(succeededEvent());
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);

    // Ledger posted exactly once; balance only dropped once.
    expect(mockRecordPayment).toHaveBeenCalledTimes(1);
    expect(store.balance[APP_ID]).toBe(0);
  });

  it("rejects the loop's webhook leg when the key is live but the event is test-mode (Part-1 guard)", async () => {
    await request(app)
      .post("/api/payments/intents")
      .set("Authorization", tokenFor(applicant))
      .send({ applicationId: APP_ID, amountCents: AMOUNT_CENTS, attemptN: 1 });

    const prev = process.env.STRIPE_SECRET_KEY;
    process.env.STRIPE_SECRET_KEY = "sk_live_abc123"; // expectedLivemode() ⇒ true
    try {
      const res = await postWebhook(succeededEvent()); // event livemode:false
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Livemode mismatch");
    } finally {
      process.env.STRIPE_SECRET_KEY = prev;
    }

    // Guard fired before dispatch: no ledger post, row still pending.
    expect(mockRecordPayment).not.toHaveBeenCalled();
    expect(store.idempotency.get(`pi:${APP_ID}:1`)?.status).toBe("pending");
  });
});
