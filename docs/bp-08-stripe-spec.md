# BP-08 — Stripe PaymentIntents Wiring (Implementation Spec)

**Status:** Spec (Draft v1). No code shipped yet.
**Replaces:** the BP-03b.1 client-side scaffold at `client-tenant/src/pages/apply/steps/StepPayment.tsx` (which fires fake beacons and never charges a card).
**Owner:** TBD (next session).
**Scope:** Real Stripe charge capture in the applicant payment wizard, with persistent idempotency, signed webhooks, and audit-grade tape beacons.

This spec is the contract a builder follows next session. Read it end-to-end before opening any branch. If a contract feels wrong, flag it in a PR comment on this doc — do not silently edit it in an implementation branch.

---

## 0. Why this exists

BP-03b.1 (Lane W) shipped the wizard's UX surface and the compliance trail, but the "Pay $X" button:

1. Generates a synthetic `paymentRef` (`pay_${Date.now()}_${random}`).
2. Fires two tape beacons (`payment-init`, `payment-success`) for compliance.
3. Marks the applicant's draft application as `submitted`.
4. **Never touches Stripe. Never charges money. Cannot fail.**

That was fine for scaffold + a feature-flag-gated demo flow. It is not fine for a CDPC system that needs:

- Real payment capture (rent + application fees).
- Strong replay protection (no double-charge on retries / reconnects).
- A complete, tamper-evident audit trail (PCI + HUD).
- A path back to BP-03b without losing the compliance trail.

BP-08 closes that gap.

---

## 1. Files locked by this spec

| Path | Purpose |
|---|---|
| `client-tenant/src/pages/apply/steps/StepPayment.tsx` | Replace fake submit with Stripe Elements + PaymentIntent confirmation. |
| `client-tenant/src/lib/stripe.ts` (new) | Singleton `loadStripe(...)` wrapper, env-driven. |
| `src/modules/payment/intents.ts` (new) | `createPaymentIntent`, idempotency-key derivation, persistence handles. |
| `src/modules/payment/webhook.ts` (new) | `POST /api/payments/webhook` — signature verification + event router. |
| `src/modules/payment/idempotency.ts` (new) | Two-layer idempotency store (Stripe header + persistent backend). |
| `src/modules/tape/index.ts` | Add four new stamp kinds (additive — no rename of existing). |
| `src/db/migrations/00XX_payment_idempotency.sql` (new) | `payment_idempotency` + `stripe_processed_events` tables. |
| `client-tenant/src/lib/flags.ts` | No change — reuse `PAYMENT_WIZARD_ENABLED`. |
| `docs/operator-runbook.md` | New `## Payment Wizard (BP-08)` section. (Edited in BP-08 PR, not here.) |

> **NB**: `stripe@^17.2.0` is already in `package.json` server-side. Client deps (`@stripe/stripe-js`, `@stripe/react-stripe-js`) are added in the BP-08 PR, not as part of this spec.

---

## 2. Stripe SDK choice + version pins

### Server (Node)
- Use `stripe` (official Node SDK). Already pinned at `^17.2.0` in `package.json` — **bump to `^18.0.0`** in BP-08 if a 18.x is current at implementation time. Otherwise keep 17.x; both expose `paymentIntents.create` with `idempotencyKey`. Read the upgrade guide before bumping; the API version (`apiVersion: '2026-XX-XX'`) must be explicitly pinned in the `new Stripe(secret, { apiVersion: ... })` call to lock event shapes.

### Client (React)
- `@stripe/stripe-js` — script loader, lazy-loads Stripe.js. Pin to current stable (`^4.x`).
- `@stripe/react-stripe-js` — `<Elements>` provider + `<PaymentElement>` component. Pin to current stable (`^3.x`).
- No raw card capture. The wizard's existing `<input>` fields (card name, number, exp, cvv, zip) are replaced wholesale by `<PaymentElement>`. **Removing them is the point** — they currently send card data through the React tree, which is a PCI scope expansion. BP-08 narrows that.

### Why these libraries (not Stripe Checkout / Payment Links)
- Wizard is in-flow. Stripe Checkout would redirect away from the application context; the post-payment "Submitted" state is hard to recover cleanly if the redirect drops.
- `<PaymentElement>` is the modern, payment-method-agnostic Element. It handles 3DS automatically and supports ACH, cards, and link with one component.

---

## 3. PaymentIntent flow

```
┌─────────────┐  1. POST /api/payments/intents  ┌─────────────┐
│  StepPayment│ ───────────────────────────────▶│  Backend    │
│  (client)   │   { applicationId, attemptN }   │             │
│             │◀──────────────────────────────  │             │
│             │   { client_secret, intentId }   │             │
│             │                                 │             │
│             │  2. stripe.confirmPayment(...)  │             │
│             │   via @stripe/react-stripe-js   │             │
└─────────────┘                                 └──────┬──────┘
       │                                               │
       │  3. Stripe handles 3DS / SCA inline           │
       │     (redirect-based or modal)                 │
       ▼                                               │
┌─────────────┐                                        │
│   Stripe    │  4. payment_intent.succeeded           │
│             │ ──────────────────────────────────────▶│
│             │     (webhook → /api/payments/webhook)  │
└─────────────┘                                        │
                                                       │
                                            5. Verify signature
                                            6. Check event.id dedupe
                                            7. Emit tape stamp
                                            8. Update application.payment_state
                                            9. 200 OK to Stripe
```

### 3.1 Client step — create the intent
- On mount of `StepPayment` (or on first user interaction — whichever lands first), call:
  ```
  POST /api/payments/intents
  Headers: Authorization: Bearer <jwt>
  Body: {
    applicationId: string,
    amount: number,       // cents — server re-validates against application
    attemptN: number      // monotonically increasing per session; see §4
  }
  ```
- Server returns `{ clientSecret: string, paymentIntentId: string, idempotencyKey: string }`.
- The wizard caches these in `ApplyContext` and Stripe-Elements state. On a "Pay" click, it calls `stripe.confirmPayment({ elements, clientSecret, ... })`.

### 3.2 Server step — create the intent
```ts
// src/modules/payment/intents.ts (sketch — do not implement here)
async function createPaymentIntent(input: {
  applicationId: string;
  amount: number;       // cents
  attemptN: number;
  actorId: string;
}): Promise<{ clientSecret: string; paymentIntentId: string; idempotencyKey: string }> {
  const idempotencyKey = `pi:${input.applicationId}:${input.attemptN}`;

  // Layer 1: backend persistent dedupe (see §4)
  const cached = await idempotency.lookup(idempotencyKey);
  if (cached) {
    // Return the existing intent's client_secret — Stripe is fine with re-displaying.
    return cached;
  }

  // Layer 2: Stripe's own idempotency header
  const intent = await stripe.paymentIntents.create(
    {
      amount: input.amount,
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      metadata: {
        applicationId: input.applicationId,
        actorId: input.actorId,
        attemptN: String(input.attemptN),
      },
    },
    { idempotencyKey }   // <-- the magic
  );

  await idempotency.store({
    key: idempotencyKey,
    intentId: intent.id,
    status: intent.status,    // 'requires_payment_method' on creation
    clientSecret: intent.client_secret!,
    applicationId: input.applicationId,
  });

  await stampTape({
    kind: 'BP08_PAYMENT_INTENT_CREATED',
    actor: input.actorId,
    payload: { intent_id: intent.id, application_id: input.applicationId, amount: input.amount },
    sessionId: idempotencyKey,    // reuses the existing per-session dedupe
  });

  return {
    clientSecret: intent.client_secret!,
    paymentIntentId: intent.id,
    idempotencyKey,
  };
}
```

### 3.3 Stripe-side confirmation
- `<PaymentElement>` collects card / ACH / link details and submits directly to Stripe via `confirmPayment`. The client only ever sees the `paymentIntentId` and the `clientSecret` — never the raw PAN. PCI scope stays minimal (SAQ-A eligible).
- 3DS / SCA: handled automatically by `automatic_payment_methods` — Stripe routes the user through a modal if a challenge is needed. No additional code path on our side.

### 3.4 Async settlement via webhook
- The client's `confirmPayment` call returns when Stripe knows the next state. The **authoritative** success/failure signal is the webhook event (`payment_intent.succeeded` / `payment_intent.payment_failed` / `payment_intent.requires_action`).
- Webhook is the single point at which we emit `payment_succeeded` / `payment_failed` tape stamps and flip `application.payment_state`. The client showing "Pay successful" is UX; the webhook is truth.

---

## 4. Idempotency key strategy (two layers)

Idempotency is non-negotiable. A duplicate charge on a Section-42 applicant is a regulatory + reputational incident.

### Layer 1 — Stripe `idempotency_key` header

- Derivation: `pi:${applicationId}:${attemptN}`.
  - `applicationId` is the immutable application UUID.
  - `attemptN` is a monotonically-increasing counter scoped to the application, persisted server-side (column `applications.payment_attempt_count`, default 0). The client gets the current value on `GET /api/payments/intents/state` and passes it back. A legitimate "Pay again after failure" increments to `attemptN+1`.
- Behavior on collision: Stripe returns the **original** PaymentIntent verbatim (including its `client_secret` and current `status`). No new charge is created. This is how Stripe's documentation prescribes retry handling.
- TTL: Stripe persists idempotency keys for **24 hours**. After that, the same key creates a fresh intent. Our backend store TTL must match (24h) so we don't think we have a duplicate when Stripe doesn't.

### Layer 2 — Backend persistent store

The BP-03b in-process `Set<string>` (see `src/modules/tape/index.ts:75 — const sessionDedupe = new Set<string>()`) is **insufficient** for real payments because:
- Server restarts wipe it.
- Multi-instance deploys (Railway autoscaling) don't share it.
- It can't survive the gap between create-intent and webhook-confirmation.

Recommendation: **Postgres table** (not Redis). See §4.3 for trade-offs.

```sql
-- src/db/migrations/00XX_payment_idempotency.sql
CREATE TABLE payment_idempotency (
  key             TEXT PRIMARY KEY,           -- e.g. 'pi:abc-123:0'
  intent_id       TEXT NOT NULL,              -- Stripe pi_...
  application_id  UUID NOT NULL REFERENCES applications(id),
  client_secret   TEXT NOT NULL,              -- for retry reads (not logged)
  status          TEXT NOT NULL,              -- last known PaymentIntent.status
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL        -- created_at + interval '24 hours'
);

CREATE INDEX payment_idempotency_app_id ON payment_idempotency (application_id);
CREATE INDEX payment_idempotency_intent_id ON payment_idempotency (intent_id);

-- Webhook event dedupe (separate concern from intent dedupe)
CREATE TABLE stripe_processed_events (
  event_id      TEXT PRIMARY KEY,             -- Stripe evt_...
  event_type    TEXT NOT NULL,
  processed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload_hash  TEXT NOT NULL                 -- sha256 of canonical event payload, for forensics
);

CREATE INDEX stripe_processed_events_type_time ON stripe_processed_events (event_type, processed_at DESC);
```

A nightly cron (already-running `node-cron` scheduler at `src/scheduler.ts`) prunes rows where `expires_at < now() - interval '7 days'` — keep a 7-day overhang past the Stripe 24h window for forensics.

### 4.1 Idempotency lookup semantics

`idempotency.lookup(key)`:
- Row exists, `status IN ('succeeded')` → return cached `{ clientSecret, paymentIntentId }`, emit `payment_replay_blocked` tape stamp.
- Row exists, `status IN ('requires_payment_method', 'requires_action')` → return cached values **without** new stamp — this is a normal "user reopened the wizard" case, not a malicious replay.
- Row exists, `status IN ('canceled', 'payment_failed')` → return cached values **and** require `attemptN` to have incremented (otherwise client gets an HTTP 409 with `{ error: 'attempt_exhausted', hint: 'increment attemptN' }`).
- Row missing → fall through to Stripe `create` with `idempotency_key`.

### 4.2 What Layer 1 alone is **not** enough for

Stripe's idempotency stops double-create at the Stripe API. It does **not** stop us from:
- Emitting two `payment_intent_created` tape stamps for the same intent (if our process restarts between create and stamp).
- Marking the application `submitted` twice.

Layer 2 closes those gaps by giving the backend a single source of truth between create and webhook.

### 4.3 Why Postgres over Redis

| Concern | Postgres | Redis |
|---|---|---|
| Already deployed | **Yes** (Railway managed PG) | No — net-new infra |
| Durability | ACID, replicated, backed up | RDB/AOF dependent on config |
| Schema-aware queries (forensics: "show me all idempotency hits today") | First-class SQL | `SCAN` over keys |
| TTL | App-level via `expires_at` + cron | Native `EXPIRE` |
| Latency at our volume | <2ms p99 in-region | <0.5ms p99 |

At Frank-Pilot scale (hundreds of payments/month, not thousands/second), the Redis latency win is invisible and the Redis ops burden is real. **Use Postgres.** Revisit if we ever cross 10 payments/sec.

---

## 5. Webhook handler skeleton

### 5.1 Route
- Path: `POST /api/payments/webhook`
- Mount: in `src/index.ts`, **before** `app.use(express.json(...))` for this route only — we need the raw body for signature verification.

```ts
// src/index.ts (sketch — adjust order, do not implement here)
import paymentWebhook from "./modules/payment/webhook";
app.post(
  "/api/payments/webhook",
  express.raw({ type: "application/json" }),
  paymentWebhook
);
// Then the normal JSON body parser for everything else.
app.use(express.json({ limit: "1mb" }));
```

### 5.2 Signature verification

```ts
// src/modules/payment/webhook.ts (sketch)
import Stripe from "stripe";
import { Request, Response } from "express";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

export default async function paymentWebhook(req: Request, res: Response) {
  const sig = req.headers["stripe-signature"];
  if (typeof sig !== "string") {
    res.status(400).send("missing signature");
    return;
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    // Bad signature, replay attempt, or wrong secret — log + 400.
    logger.warn("stripe webhook signature failed", { error: (err as Error).message });
    res.status(400).send("invalid signature");
    return;
  }

  // Event dedupe (see §4 stripe_processed_events).
  const already = await query(
    "SELECT 1 FROM stripe_processed_events WHERE event_id = $1",
    [event.id]
  );
  if (already.rowCount > 0) {
    res.status(200).send("duplicate, ignored");
    return;
  }

  try {
    await handleEvent(event);   // routes to switch on event.type
    await query(
      "INSERT INTO stripe_processed_events (event_id, event_type, payload_hash) VALUES ($1, $2, $3)",
      [event.id, event.type, sha256(canonicalJson(event))]
    );
    res.status(200).send("ok");
  } catch (err) {
    // CRITICAL: do NOT 5xx on transient errors — Stripe will retry 3+ days.
    // Better to 200 + DLQ to an internal retry table than to flap.
    logger.error("webhook handler failed", { event_id: event.id, error: (err as Error).message });
    await deadLetter(event);
    res.status(200).send("dead-lettered");
  }
}
```

### 5.3 Events handled (v1)

| Event | Action |
|---|---|
| `payment_intent.succeeded` | Emit `BP08_PAYMENT_SUCCEEDED` tape stamp. Update `applications.payment_state = 'paid'`. Insert a `payment_ledger` entry (reuse `PaymentService.recordPayment` semantics from `src/modules/tenant/routes.ts:247`). |
| `payment_intent.payment_failed` | Emit `BP08_PAYMENT_FAILED` tape stamp. Update `applications.payment_state = 'failed'`. Surface `last_payment_error` to the applicant on next wizard view. |
| `payment_intent.requires_action` | No tape stamp (this is a normal SCA pause). Update `payment_idempotency.status` only. |
| `charge.refunded` | Emit `BP08_PAYMENT_REFUNDED` tape stamp. **Defer full refund flow to BP-09** — for v1, log + alert only. |

Any event type not in this table is acknowledged (`200 ok`) and ignored. Do not 4xx unknown events — that triggers Stripe retry storms.

### 5.4 Dead-letter table (optional but recommended)

```sql
CREATE TABLE stripe_webhook_dlq (
  event_id     TEXT PRIMARY KEY,
  event_type   TEXT NOT NULL,
  payload      JSONB NOT NULL,
  error        TEXT NOT NULL,
  first_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
  retry_count  INT NOT NULL DEFAULT 0,
  resolved_at  TIMESTAMPTZ
);
```

An operator-only `/api/payments/webhook/dlq` route surfaces these; a daily cron retries unresolved rows with exponential backoff for 7 days, then alerts.

---

## 6. Tape beacon updates

BP-03b emits two stamps. BP-08 adds four more. All BP-03b consumers (auditor, operator-runbook grep patterns) keep working — new stamps are **additive only**.

### 6.1 New stamp kinds (additive to `TAPE_STAMP_KINDS` in `src/modules/tape/index.ts:26`)

```ts
export const TAPE_STAMP_KINDS = {
  // ...existing five HUD stamps + BP03B_PAYMENT_INITIATED, BP03B_PAYMENT_SUCCEEDED unchanged...
  BP08_PAYMENT_INTENT_CREATED: "bp08.payment_intent_created",
  BP08_PAYMENT_SUCCEEDED:      "bp08.payment_succeeded",
  BP08_PAYMENT_FAILED:         "bp08.payment_failed",
  BP08_PAYMENT_REPLAY_BLOCKED: "bp08.payment_replay_blocked",
} as const;

export const TAPE_CITATIONS: Record<TapeStampKind, string> = {
  // ...existing...
  BP08_PAYMENT_INTENT_CREATED: "HUD 4350.3 Ch. 4-6",
  BP08_PAYMENT_SUCCEEDED:      "HUD 4350.3 Ch. 4-6",
  BP08_PAYMENT_FAILED:         "HUD 4350.3 Ch. 4-6",
  BP08_PAYMENT_REPLAY_BLOCKED: "HUD 4350.3 Ch. 4-6",
};
```

### 6.2 Replacement map (BP-03b → BP-08)

| BP-03b stamp | BP-08 replacement | Trigger |
|---|---|---|
| `bp03b.payment_initiated` | `bp08.payment_intent_created` | Server creates PaymentIntent |
| `bp03b.payment_succeeded` | `bp08.payment_succeeded` | Webhook receives `payment_intent.succeeded` |
| — | `bp08.payment_failed` | Webhook receives `payment_intent.payment_failed` |
| — | `bp08.payment_replay_blocked` | Idempotency layer returns cached intent (§4.1) |

When `PAYMENT_WIZARD_ENABLED=true` **and** `STRIPE_LIVE_ENABLED=true` (new flag, see §7): the wizard emits BP-08 stamps and stops emitting BP-03b stamps. With `STRIPE_LIVE_ENABLED=false` (default): BP-03b stamps continue.

### 6.3 Payload schema

All BP-08 stamps:
```json
{
  "timestamp": "2026-MM-DDTHH:MM:SS.sssZ",
  "kind": "bp08.payment_succeeded",
  "citation": "HUD 4350.3 Ch. 4-6",
  "actor": "<applicantId or 'tenant'>",
  "session_id": "pi:<applicationId>:<attemptN>",
  "payload": {
    "intent_id": "pi_...",
    "application_id": "<uuid>",
    "amount": <int cents>,
    "currency": "usd",
    "status": "succeeded",
    "stripe_event_id": "evt_..."     // omitted on intent_created (no event yet)
  }
}
```

The `session_id` is **the idempotency key**, deliberately. This gives one grep to pull all stamps for a single payment attempt:

```bash
grep '"session_id":"pi:app-123:0"' server/tape/bp08.ndjson
```

### 6.4 Ledger file

- New ledger path: `server/tape/bp08.ndjson` (override: `BP08_LEDGER_PATH`).
- BP-03b's `bp03b.ndjson` stays in place — never migrate or rename historical rows. The audit story is: "BP-03b ran for X weeks, then BP-08 took over; both files are append-only and complete."
- When canonical BP-02 (`compliance_tape` table) ships, both NDJSON files migrate into it in one pass.

---

## 7. Env vars + secrets

| Var | Surface | Where stored | Example |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | server only | 1Password + Railway secrets | `sk_test_...` (dev), `sk_live_...` (prod) |
| `STRIPE_PUBLISHABLE_KEY` | server → client (via `/api/payments/config`) | 1Password + Railway + Vercel | `pk_test_...` / `pk_live_...` |
| `STRIPE_WEBHOOK_SECRET` | server only | 1Password + Railway secrets | `whsec_...` |
| `STRIPE_LIVE_ENABLED` | server only | Railway env | `false` (default) / `true` |
| `VITE_PAYMENT_WIZARD_ENABLED` | client | Vercel env | unchanged (`false` default) |
| `BP08_LEDGER_PATH` | server only | Railway (optional) | `server/tape/bp08.ndjson` (default) |

### Rules

- **No `.env` commits.** Source of truth is 1Password (canonical) + Railway/Vercel secrets (runtime). `.env.local` is a dev convenience, gitignored.
- Publishable key is sent to the client only via a small `/api/payments/config` route — **not** baked into the Vite build. This lets us rotate the publishable key without a frontend redeploy.
- The boot-time guardrail at `src/index.ts:41-48` must be extended: when `STRIPE_LIVE_ENABLED=true` in production, refuse to start without `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`. Same crash-loud-not-fail pattern as JWT/encryption keys.

---

## 8. Feature flags (no new client flag)

We **reuse** `PAYMENT_WIZARD_ENABLED` for the UX surface (already in `client-tenant/src/lib/flags.ts:12`). We add **one** server flag, `STRIPE_LIVE_ENABLED`, that gates whether the server uses Stripe or the BP-03b fake path.

| `VITE_PAYMENT_WIZARD_ENABLED` | `STRIPE_LIVE_ENABLED` | Behavior |
|---|---|---|
| false | false | Wizard hidden — applicant skips to `?step=2`. (Current prod default.) |
| true | false | Wizard renders. Submit fires BP-03b fake beacons. (Current dev default.) |
| true | true | Wizard renders with `<PaymentElement>`. Submit creates real PaymentIntent. (BP-08 production.) |
| false | true | **Refuse to boot** — misconfiguration. Server logs error + crashes (matches the JWT/encryption pattern). |

### 8.1 Flip criteria (production)

Before `STRIPE_LIVE_ENABLED=true` ships to prod:

- ≥10 successful test-mode payments end-to-end (Stripe `test_*` keys).
- Webhook signature verification green in staging for ≥48h with no `400 invalid signature` log entries.
- Tape beacon audit clean: every successful test-mode payment has a matching `bp08.payment_intent_created` **and** `bp08.payment_succeeded` row in `bp08.ndjson`, with matching `intent_id`.
- Idempotency replay test green: same `attemptN` re-submitted → server returns cached intent + emits `bp08.payment_replay_blocked` (verified by integration test).
- Sentry (or whatever error tracker is wired by then) capturing PaymentIntent errors with PII-safe context (`intent_id`, `applicationId`, no card data).
- Code-review sign-off from someone other than the implementer (Opus subagent audit per the Sandwich rule — payment code is auth/billing class, high blast radius).

### 8.2 Rollback

- Flip `STRIPE_LIVE_ENABLED=false`. Server restarts (Railway propagates env changes within ~30s).
- Wizard continues working — falls back to BP-03b fake submit path.
- Stripe Dashboard: no PaymentIntents created from this point forward; in-flight intents settle normally via webhook.
- Tape: `bp08.ndjson` stops growing; `bp03b.ndjson` resumes. No data loss.
- The two-flag gate means rollback is a single env var flip, not a code deploy.

---

## 9. Test plan

### 9.1 Unit (Jest)
- `src/__tests__/payment/intents.test.ts` (new): mock Stripe SDK, assert idempotency-key derivation (`pi:${appId}:${attemptN}`), assert tape beacon emission on each path.
- `src/__tests__/payment/webhook.test.ts` (new): construct synthetic `Stripe.Event` payloads, assert signature-verification rejects bad signatures, assert event dedupe via `stripe_processed_events`, assert correct stamps per event type.
- `src/__tests__/payment/idempotency.test.ts` (new): in-memory PG (existing test infra), assert all four lookup paths from §4.1.

### 9.2 Integration (Jest + supertest)
- Boot the Express app with `STRIPE_LIVE_ENABLED=true` and `STRIPE_SECRET_KEY=sk_test_...` from a Stripe test account.
- Card under test: `4242 4242 4242 4242` (success), `4000 0000 0000 9995` (insufficient funds), `4000 0027 6000 3184` (3DS required).
- For each card: create intent → confirm via SDK → trigger webhook via Stripe CLI → assert tape stamp + DB state.

### 9.3 Webhook end-to-end (local + staging)
- Local: `stripe listen --forward-to localhost:3000/api/payments/webhook` (Stripe CLI). Use `stripe trigger payment_intent.succeeded` etc.
- Staging: configure a real webhook endpoint in Stripe Dashboard pointing at the staging URL. Stripe sends a test event on creation — that must `200`. Verify via Stripe Dashboard's "Recent deliveries" panel.

### 9.4 Idempotency replay test (the load-bearing one)
```ts
// Sketch — assert this passes before flipping STRIPE_LIVE_ENABLED in prod
test("replay with same attemptN returns cached intent + emits replay_blocked stamp", async () => {
  const r1 = await request(app).post("/api/payments/intents").send({ applicationId, amount: 9500, attemptN: 0 });
  const r2 = await request(app).post("/api/payments/intents").send({ applicationId, amount: 9500, attemptN: 0 });

  expect(r1.body.paymentIntentId).toBe(r2.body.paymentIntentId);  // same intent
  expect(r1.body.clientSecret).toBe(r2.body.clientSecret);          // same secret

  const stamps = await readBp08Ledger();
  expect(stamps.filter(s => s.kind === 'bp08.payment_intent_created').length).toBe(1);  // create stamped once
  expect(stamps.filter(s => s.kind === 'bp08.payment_replay_blocked').length).toBe(1);  // replay stamped once
});
```

### 9.5 Regression — BP-03b smoke must still pass
- With `VITE_PAYMENT_WIZARD_ENABLED=true` and `STRIPE_LIVE_ENABLED=false`, the existing 21-check apply smoke (see `project_apply_smoke_regression.md` in memory) must pass unmodified.
- With `STRIPE_LIVE_ENABLED=true`, a new smoke variant exercises the real PaymentIntent flow against `sk_test_...` keys in CI.

---

## 10. Migration path (BP-03b → BP-08)

### Phase 1 — Ship dark (week 0)
- `STRIPE_LIVE_ENABLED=false` everywhere.
- BP-08 code paths are present but inert.
- All §9.1 + §9.2 tests green in CI.

### Phase 2 — Internal dogfood (week 1)
- Flip `STRIPE_LIVE_ENABLED=true` in staging only.
- Internal test users complete real test-mode payments.
- §9.3 webhook deliveries observed in Stripe Dashboard.
- §8.1 flip criteria checked off one by one.

### Phase 3 — Per-applicant rollout (week 2)
- Add `applications.payment_provider` enum column: `'bp03b_scaffold' | 'bp08_stripe'`. Default `'bp03b_scaffold'`.
- Operator can flip individual applications to `'bp08_stripe'` for early-access cohorts.
- Server reads this column at intent-create time; routes accordingly.

### Phase 4 — Default flip (week 3+)
- Change column default to `'bp08_stripe'` for new applications.
- Existing in-flight applications stay on whatever provider they started with (no retroactive migration).
- After 30 days with no `'bp03b_scaffold'` flow in active use, deprecate the BP-03b fake submit path. (The tape ledger stays — append-only.)

### Rollback at any phase
- Flip `STRIPE_LIVE_ENABLED=false`. Done. (See §8.2.)

---

## 11. Risks + open questions

### 11.1 PCI scope
- Using `<PaymentElement>` keeps us in SAQ-A (the lightest PCI scope) — Stripe.js loads in an iframe Stripe controls, card data never enters our DOM tree. **Confirm in BP-08 PR** that the React tree never has a `<form>` containing card fields outside the Element. The current scaffold's fields (`name`, `number`, `exp`, `cvv`, `zip`) must be **deleted**, not "hidden" or "disabled" — they must not exist in the bundle.

### 11.2 Refund + dispute handling — **defer to BP-09**
- BP-08 v1: log `charge.refunded` to tape, no automatic refund flow. Operators handle refunds in the Stripe Dashboard manually.
- BP-08 v1: dispute (`charge.dispute.created`) → email alert to operators, no automated response.
- BP-09 owns the refund UX, partial-refund support, and dispute response packets.

### 11.3 3DS / Strong Customer Authentication
- Handled automatically by `automatic_payment_methods: { enabled: true }`. No extra code path. Stripe routes the user through a modal during `confirmPayment`. Mention in operator runbook so support knows what the "verify with bank" screen is.

### 11.4 ACH and slow settlement
- ACH PaymentIntents take 3-5 business days to settle (`payment_intent.processing` → `payment_intent.succeeded` later). Wizard UX needs a "Payment processing — we'll email you when it clears" state. Tape stamps: emit `bp08.payment_intent_created` on creation, `bp08.payment_succeeded` only on actual webhook success. Do not flip `application.payment_state = 'paid'` until success.

### 11.5 Application fee model
- Spec assumes a single up-front charge. The wizard currently quotes `state.paymentTotal` which is a string. For BP-08, the **server** computes the cents amount from the application (rent + fees + AMI tier discounts) and the client only displays it. Never trust client-sent `amount`.

### 11.6 Currency
- Hard-coded `usd` in v1 (all properties are Nevada). Defer multi-currency to a hypothetical international expansion.

### 11.7 Webhook ordering
- Stripe does **not** guarantee event ordering. `payment_intent.succeeded` can arrive before `charge.succeeded`. Handler must be order-independent: each event type updates only the fields it owns. The `stripe_processed_events` dedupe table also catches replays out of order.

### 11.8 Open questions for next session

1. **Do we want Stripe Customer creation on intent-create, or defer to first successful payment?** Current `src/modules/payment/service.ts:26` has a `createCustomer` flow already. BP-08 spec says "PaymentIntent first, attach to Customer on success" — confirm this matches the operator's mental model, or flip to "Customer first" if recurring payments are imminent (BP-08.1?).
2. **Receipt emails — Stripe-native or Frank-Pilot-native?** Stripe sends receipt emails automatically when `receipt_email` is set on the PaymentIntent. We already have a Resend integration. Cheaper to use Stripe's; better-branded to use ours. Pick one.

---

## 12. Implementation effort estimate

Honest read, single competent engineer working in the BP-03b codebase:

| Phase | Effort |
|---|---|
| §3 + §4 (intents + idempotency + new tables) | 1.5 days |
| §5 (webhook handler + event router + dedupe) | 1 day |
| §6 (tape stamps additions + ledger split) | 0.5 day |
| §7 + §8 (env wiring + boot guard + flag wiring) | 0.5 day |
| §9.1 + §9.2 (unit + integration tests) | 1 day |
| §9.3 + §9.4 (Stripe CLI E2E + replay test in CI) | 0.5 day |
| Client-side: replace `StepPayment` form with `<PaymentElement>` + `confirmPayment` glue | 1 day |
| Documentation pass (operator-runbook + PR description) | 0.5 day |
| **Subtotal — happy path** | **6.5 person-days** |
| Buffer for unknowns (Stripe API version drift, PG migration churn, webhook DLQ polish) | +1.5 days |
| **Total — defensible estimate** | **8 person-days** |

If routed through the cheap engines (Codex for the route work, M2.7 for tests), wall-clock can compress to ~3-4 days with Sonnet integrating and Opus auditing the final diff. Per the Sandwich rule, the Opus audit is non-negotiable for this class of work.

---

## 13. Out of scope (explicitly)

- Recurring rent payments + Stripe Subscriptions. (Owned by a future BP-10 if it ships.)
- Refunds, partial refunds, disputes. (BP-09.)
- Multi-currency. (Not on the roadmap.)
- ApplePay/GooglePay specific surfaces. (`<PaymentElement>` handles them; no custom code needed.)
- Migrating `bp03b.ndjson` historical rows into canonical BP-02. (BP-02 migration owns this.)
- Auto-pay enrollment as part of the wizard. (Already covered by `PaymentService.enrollAutoPay` post-onboarding — leave it where it is.)

---

## 14. Acceptance checklist (paste into the BP-08 PR description)

- [ ] `client-tenant/src/pages/apply/steps/StepPayment.tsx` no longer contains raw card `<input>` fields.
- [ ] `@stripe/stripe-js` + `@stripe/react-stripe-js` pinned in `client-tenant/package.json`.
- [ ] `src/modules/payment/{intents,webhook,idempotency}.ts` exist with the public surfaces described in §3-§5.
- [ ] Migration creates `payment_idempotency` + `stripe_processed_events` tables.
- [ ] `src/modules/tape/index.ts` has four new `BP08_*` kinds, all citing HUD 4350.3 Ch. 4-6.
- [ ] `server/tape/bp08.ndjson` is gitignored and writeable.
- [ ] `STRIPE_LIVE_ENABLED=false` default; boot-time guard refuses contradictory states (§8).
- [ ] All §9 tests green in CI, including the replay-blocked assertion.
- [ ] Operator runbook section added.
- [ ] BP-03b smoke regression passes unchanged.
- [ ] Opus audit (per `/audit-before-ship`) PASS before merge.
