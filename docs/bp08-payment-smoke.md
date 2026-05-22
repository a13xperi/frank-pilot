# BP-08 — Local payment smoke test

Proves the full client→Stripe→webhook→ledger loop end-to-end in **test mode**, on
a local stack, with no real money. This is the manual companion to the automated
guards:

- `src/__tests__/payment-e2e-loop.test.ts` — backend loop (deterministic, in CI).
- `client-tenant/e2e/scenarios/pay.spec.ts` — UI surface (`@payments`, opt-in).

## Why this needs a flag note first

The webhook's livemode guard keys off the **secret-key prefix**
(`expectedLivemode()` in `src/lib/stripe.ts`), not `STRIPE_LIVE_ENABLED`. So a
`sk_test_…` key expects `livemode:false` events — which is exactly what Stripe
test mode sends. `STRIPE_LIVE_ENABLED` stays a pure route + client-render switch
and can be `true` while you run entirely on test keys. (Before this decoupling a
test-mode loop was impossible: the flag had to be `true` to render the UI, which
made every `livemode:false` test webhook bounce with `400`.)

## 1. Test-mode env

In the API's local `.env` (test keys from the Stripe Dashboard → *Developers →
API keys*, in **Test mode**):

```
STRIPE_SECRET_KEY=sk_test_…
STRIPE_PUBLISHABLE_KEY=pk_test_…
STRIPE_LIVE_ENABLED=true          # route + client render on
COMPLIANCE_TAPE_V2_ENABLED=true   # so BP08 tape stamps fire
```

For the client (`client-tenant/.env`), build with the Stripe surface on:

```
VITE_PAYMENT_WIZARD_ENABLED=true
```

## 2. Forward webhooks to localhost

```bash
stripe listen --forward-to localhost:3000/api/payments/webhook
```

Copy the printed `whsec_…` into the API's `STRIPE_WEBHOOK_SECRET`, then restart
the API so the boot guard and webhook verifier pick it up.

> The webhook is mounted **before** `express.json()` (`src/index.ts`) and uses
> `express.raw`, so Stripe's signature verifies against the raw body. Don't put
> a JSON body-parser in front of it.

## 3. Seed a payable tenant

The default seed (`npm run seed`) has no tenant with a balance. Seed the demo
data, which creates `demo-tenant@example.com` (Tomasz Kowalski) linked to an
onboarded application with a delinquent ledger balance:

```bash
npm run seed:demo
```

## 4. Run the stack and pay

```bash
npm run dev                       # API on :3000
cd client-tenant && npm run dev   # client on :5174
```

1. Sign in as `demo-tenant@example.com` (dev magic-link).
2. Go to `/pay`. The Stripe `PaymentElement` should render (server `config.enabled`
   + publishable key + `VITE_PAYMENT_WIZARD_ENABLED`).
3. Enter test card **`4242 4242 4242 4242`**, any future expiry, any CVC, any ZIP.
4. Submit.

## 5. Assert the full loop

| Where | Expect |
|-------|--------|
| `stripe listen` output | `payment_intent.succeeded` forwarded → `200` |
| `payment_idempotency` | row for `pi:<appId>:<attemptN>` → `status='succeeded'` |
| `tenant_ledger` | new `payment` entry (negative amount), `balance_after` reduced |
| `/api/tenant/dashboard` | `balance.balance` dropped by the paid amount |
| `stripe_processed_events` | the event id present (dedupe) |
| `stripe_webhook_dlq` | empty (no dispatch failure) |
| compliance tape | `BP08_PAYMENT_INTENT_CREATED` then `BP08_PAYMENT_SUCCEEDED` |

Quick SQL checks:

```sql
SELECT idempotency_key, status, payment_intent_id FROM payment_idempotency ORDER BY created_at DESC LIMIT 3;
SELECT entry_type, amount, balance_after, reference_id FROM tenant_ledger ORDER BY created_at DESC LIMIT 3;
SELECT event_id, event_type FROM stripe_processed_events ORDER BY processed_at DESC LIMIT 3;
SELECT count(*) FROM stripe_webhook_dlq WHERE attempt_count < 5;  -- expect 0
```

## Idempotency spot-check (optional)

Re-deliver the same event from the Stripe CLI and confirm it short-circuits
(`200 { duplicate: true }`) with **no** second ledger row:

```bash
stripe events resend <evt_id>
```

## Failure-path spot-check (optional)

Use the decline card `4000 0000 0000 0002`. Expect `payment_intent.payment_failed`
→ `payment_idempotency.status='failed'`, **no** ledger entry, a
`BP08_PAYMENT_FAILED` tape stamp. To retry, the client bumps `attemptN` (a repeat
with the same terminal key returns `409`).
