# BP-08 — Live-Mode Cutover Checklist

The Stripe payment loop (charge → webhook → ledger → receipt) and the refund
loop (refund request → `charge.refunded` → offsetting ledger entry → refund
email) are **proven on prod in test mode**. Cutover to live money is an **ops +
verification** step — no code change is required.

The code keys mode off the **secret-key prefix**, not a flag:
`expectedLivemode()` returns `true` the moment `STRIPE_SECRET_KEY` starts with
`sk_live_`. The webhook then accepts only `livemode:true` events and rejects
test-mode ones (and vice-versa), so a half-finished cutover fails loud instead of
posting wrong-mode money. The boot-guard (`boot-guard.ts`) refuses to start
(`process.exit(1)`) if `STRIPE_LIVE_ENABLED=true` and any of the three Stripe keys
is missing or a placeholder.

> ⚠️ Do not begin until Alex gives an explicit real-money go. Live mode moves real
> funds. Test every step in test mode first (already done).

## Steps

1. **Swap the keys** in the Railway `api` service env:
   - `STRIPE_SECRET_KEY` → `sk_live_…`
   - `STRIPE_PUBLISHABLE_KEY` → `pk_live_…`
   - (Vite) `VITE_STRIPE_PUBLISHABLE_KEY` on the tenant client → `pk_live_…`,
     then redeploy the client so the live publishable key ships.

2. **Register a LIVE webhook endpoint** in the Stripe Dashboard (live mode):
   - URL: `https://api-production-ed89.up.railway.app/api/payments/webhook`
   - Events: `payment_intent.succeeded`, `payment_intent.payment_failed`,
     **`charge.refunded`** (required for the refund loop to post the offsetting
     ledger entry).
   - Copy the endpoint's live signing secret (`whsec_…`) into Railway
     `STRIPE_WEBHOOK_SECRET`.

3. **Flags stay on:** `STRIPE_LIVE_ENABLED=true`, `VITE_PAYMENT_WIZARD_ENABLED=true`.

4. **Redeploy api.** The boot-guard passes only when all three keys are present
   and non-placeholder. Confirm in logs that the process booted (no
   `STRIPE_*` boot-guard exit) and that `expectedLivemode()===true` (a test-mode
   event would now be rejected with a 400 "Livemode mismatch").

5. **Smoke (one small REAL charge):**
   - Run one minimal payment through the prod tenant UI with a real card.
   - Confirm: a `payment` ledger row posts, the balance recomputes, and the
     tenant receives the receipt email (real Resend send — verify `RESEND_API_KEY`
     and a verified-domain `RESEND_FROM` are set; the sandbox sender only
     delivers to the account owner).
   - Immediately **refund it** via `POST /api/payments/refunds`
     (`{ "paymentIntentId": "pi_…" }`, staff `ledger:manage` token).
   - Confirm: a `refund` ledger row posts (positive amount, balance restored),
     `payment_idempotency.refund_status='succeeded'`, and the refund-confirmation
     email fires.
   - Clean up the smoke rows afterward (note: `audit_log` is append-only by
     trigger — leave those rows).

## Rollback

Swap the keys back to `sk_test_…`/`pk_test_…`, restore the test `whsec_…`, and
redeploy. `expectedLivemode()` flips back to `false` automatically; no code revert
needed.
