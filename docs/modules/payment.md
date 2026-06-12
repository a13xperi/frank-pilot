# payment

## Purpose

Tokenized rent payment processing via Stripe, with auto-pay enrollment carrying a
$25/month rent-reduction incentive. Owns the PaymentIntent lifecycle, idempotency,
refunds, and the handoff into the tenant ledger. PCI posture: card data is tokenized
client-side — raw card numbers never touch this server.

## Workflow encoded

1. Create Stripe customer — `POST /api/payments/:applicationId/customer`.
2. Attach tokenized payment method — `POST /api/payments/:applicationId/method`.
3. Enroll auto-pay — `POST /api/payments/:applicationId/auto-pay` ($25/mo discount).
4. Create PaymentIntent — `POST /api/payments/intents`, idempotent on
   `(applicationId, attemptN)`; the client must increment `attemptN` to unmask 409 replays.
5. Webhook receiver consumes `payment_intent.succeeded` / `charge.refunded`: posts the
   ledger entry, stamps the tape, and may advance application status.
6. Refunds — `POST /api/payments/refunds` records the request; the `charge.refunded`
   webhook resolves it. A refund is only valid against a payment whose idempotency row
   is `succeeded`.

State machine — `payment_idempotency.status`: `pending → succeeded | failed`.
Webhook idempotency: `stripe_processed_events` dedupes by `event_id`; failures land in
`stripe_webhook_dlq` (receiver always answers 200 so Stripe doesn't disable us).

## Data model

| Table | Load-bearing pieces |
|---|---|
| `payment_idempotency` | `idempotency_key` PK, `application_id` FK, `status`, `payment_intent_id`, `client_secret`, `amount_cents`, `refund_id`, `refund_status` |
| `stripe_processed_events` | `event_id` PK, `event_type`, `application_id` |
| `stripe_webhook_dlq` | `event_id` UNIQUE, `raw_payload`, `error_message`, `attempt_count`, first/last failed timestamps |
| `applications` (columns) | `stripe_customer_id`, `stripe_payment_method_id`, `auto_pay_enrolled`, `payment_method` enum (`ach`/`credit_card`/`debit_card`/`bank_transfer`) |
| `tenant_ledger` | receives `payment` entries linked via `reference_id` = PaymentIntent id |

## API surface

| Route | Permission |
|---|---|
| `POST /api/payments/:applicationId/customer` | `payment:setup` |
| `POST /api/payments/:applicationId/method` | `payment:setup` |
| `POST /api/payments/:applicationId/auto-pay` | `payment:setup` |
| `GET /api/payments/:applicationId` | `payment:view` |
| `POST /api/payments/intents` | authenticate + requireEmailVerified (applicant/tenant) |
| `POST /api/payments/config` | public — serves publishable key + enabled flag |
| `POST /api/payments/refunds` | `payment:manage` |
| Stripe webhook | mounted at `/api/payments/webhook` **before** `express.json()` (raw-body HMAC; do not reorder) |

## Compliance anchors

Tape stamps (all cite HUD 4350.3 Ch. 4-6): `BP08_PAYMENT_INTENT_CREATED`,
`BP08_PAYMENT_SUCCEEDED`, `BP08_PAYMENT_FAILED`, `BP08_PAYMENT_REPLAY_BLOCKED`,
`BP08_PAYMENT_REFUND_REQUESTED`, `BP08_PAYMENT_REFUNDED`.
Triple idempotency: Stripe request header, `payment_idempotency` table, processed-events dedupe.

## Flags & env

- `STRIPE_LIVE_ENABLED` — gates real Stripe init. `boot-guard.ts` **crashes the process**
  if the flag is true with placeholder keys; flag off = stub customer ids.
- `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` / `STRIPE_WEBHOOK_SECRET` — required
  only when live.
- `SCREENING_ON_SUBMIT_ENABLED` — succeeded-payment webhook may trigger `runFullScreening`.

## Current state

Code complete; **flag-dark** (`STRIPE_LIVE_ENABLED=false`, spec §8.1 gating). Webhook +
refund lifecycle wired. Gaps: **no fee pass-through line items** (CFO expects transaction
fees passed to tenants), no lease-modification acceptance enforced pre-payment.

## Key files

`src/modules/payment/` — `service.ts`, `intents.ts`, `webhook.ts`, `idempotency.ts`,
`routes.ts`, `boot-guard.ts`, `config.ts`, `refunds.ts`.
