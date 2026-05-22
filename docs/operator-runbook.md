# Operator Runbook

Operational reference for Frank-Pilot CDPC operators.

---

## Compliance Tape (BP-02)

### What the Compliance Tape is

The Compliance Tape is a hash-chained, append-only audit ledger stored in
Postgres. Every regulated event — welcome letter delivery, fair-housing
posting, waiting-list capture, HUD-92006 supplement, position letter — writes
one row. Once written, a row cannot be edited or deleted; the database trigger
rejects any attempt. Operators can only add new entries.

### Operator-portal actions that write to the tape

| Action | Tape Kind | HUD / CFR citation |
| --- | --- | --- |
| Welcome letter delivered | `WELCOME_LETTER_DELIVERED` | HUD 4350.3 Ch. 4-4 |
| Fair-housing notice posted | `HUD_928_1_FAIR_HOUSING_POSTED` | 24 CFR Part 110 |
| Applicant captured to waiting list | `WAITING_LIST_APP_CAPTURED` | HUD 4350.3 Ch. 4-6 |
| HUD-92006 supplement filled | `HUD_92006_SUPPLEMENT_CAPTURED` | HUD-92006 |
| Position letter sent | `POSITION_LETTER_SENT` | HUD 4350.3 Ch. 4-14 + 4-16 |

### How to view the tape

1. Sign into the operator portal as **Operator+**.
2. Navigate to **Audit Log** (existing page). The **Compliance Tape** panel is
   at the bottom.
3. Enter an applicant ID. The table renders all tape entries for that
   applicant in sequence order.

### How to export a PDF for an applicant

1. On the Compliance Tape panel, click **Export PDF**.
2. The PDF contains every entry with its rule citation. The SHA-256 of the
   latest entry appears in the footer.
3. The file downloads as `compliance-tape-<applicantId>.pdf`.
4. Use this for HUD attestations, legal requests, and internal audits.

### How "Verify Chain" works

- Click **Verify Chain**. The portal walks every entry, recomputes each row's
  SHA-256, and confirms that each link is intact.
- **Green badge "Verified ✓ (sequence N)"** — tape is intact.
- **Red badge "Break at sequence M — \<reason\>"** — someone bypassed the
  append-only safeguards (DB tamper or migration accident). Treat as a **P0
  incident**: capture a screenshot of the page and escalate to engineering
  immediately.

### Rollout flag

The new tape (v2) is gated by `COMPLIANCE_TAPE_V2_ENABLED`.

| Environment | Status |
| --- | --- |
| Staging | ON once Lane B + Lane G ship |
| Production | ON after one clean deploy cycle in staging |

During cutover the system **dual-writes** — new Postgres tape and legacy NDJSON
simultaneously. The NDJSON writer is removed in a follow-up PR once one full
deploy cycle in staging is clean.

### Rollout status (as of 2026-05-22)

| Env       | `COMPLIANCE_TAPE_V2_ENABLED` | Writes to        | Verify command |
| --------- | ---------------------------- | ---------------- | -------------- |
| local-dev | `true` (developer choice)    | Postgres + NDJSON | `node scripts/post-deploy-verify.mjs http://localhost:3000 --verify-dual-write` (requires `DATABASE_URL` to local Postgres) |
| Railway prod | `false` (legacy NDJSON only) | NDJSON only      | `node scripts/post-deploy-verify.mjs https://api-production-ed89.up.railway.app` |

**Cutover gate** (per [`docs/bp-02-contracts.md`](bp-02-contracts.md)): flip
Railway to `true` only after one clean staging deploy where the dual-write
parity check passes — NDJSON line-count == `compliance_tape` row-count for
the same `session_id` over a representative window. Use
`--verify-dual-write` against staging to confirm. Once parity has held for
one full deploy cycle, remove the NDJSON writer in a follow-up PR.

### Where the data lives

- **Table:** `compliance_tape` (Postgres)
- **Append-only:** enforced by DB trigger — UPDATE, DELETE, and TRUNCATE are
  all rejected by the database itself.
- **Migration:** `src/db/migrations/2026-05-23-compliance-tape.sql`

### Engineering reference

- Contract: `docs/bp-02-contracts.md`
- Source: `src/modules/tape/`

---

## Compliance Tape (BP-03b)

All HUD-cited touchpoints append to the BP-03b NDJSON ledger:

- **Path:** `server/tape/bp03b.ndjson` (override with `TAPE_LEDGER_PATH` env)
- **Format:** one JSON object per line — `{ timestamp, kind, citation, actor, payload, session_id? }`
- **Idempotency:** dedupe is per `(kind, session_id)` within the process lifetime.

Quick filter for the payment beacons:

```bash
grep -E '"kind":"BP03B_PAYMENT_(INITIATED|SUCCEEDED)"' server/tape/bp03b.ndjson
```

---

## Payment Wizard (scaffold)

**Status:** scaffold-only. **There is no real Stripe wiring in this branch.**
BP-08 owns real payment processing; BP-03b.1 only ships the client UX scaffold and
server-side tape beacons so the wizard's compliance trail exists end-to-end.

### Feature flag

- `VITE_PAYMENT_WIZARD_ENABLED` (client-tenant) — defaults to `false`.
- Flip to `true` only in environments where the wizard scaffold should render
  on the applicant flow. Do **not** enable in production until BP-08 lands.

### Beacons emitted

Both endpoints accept `{ session_id, adults, total }`, return `200`, and are
idempotent per `session_id` (a repeat call writes nothing and returns
`idempotent: true`).

| Endpoint | Stamp kind | HUD cite |
| --- | --- | --- |
| `POST /api/tape/payment-init` | `bp03b.payment_initiated` | 4350.3 Ch. 4-6 |
| `POST /api/tape/payment-success` | `bp03b.payment_succeeded` | 4350.3 Ch. 4-6 |

Validation: `session_id` is required and must be a non-empty string. Missing
or empty `session_id` returns `400`.

### Operator checks

To confirm a session's payment journey landed in the ledger:

```bash
SESSION_ID=sess-abc123
grep "\"session_id\":\"$SESSION_ID\"" server/tape/bp03b.ndjson \
  | grep -E '"kind":"BP03B_PAYMENT_(INITIATED|SUCCEEDED)"'
```

Expect at most one row per `(kind, session_id)` pair. If you see more, the
in-process dedupe was bypassed (likely a restart between init and success);
this is harmless for the scaffold but worth noting for BP-08 when real
money is involved.

### Manual smoke test

```bash
curl -sS -X POST http://localhost:3001/api/tape/payment-init \
  -H 'content-type: application/json' \
  -d '{"session_id":"smoke-1","adults":2,"total":95}'
# → {"ok":true,"kind":"bp03b.payment_initiated","session_id":"smoke-1","idempotent":false}

curl -sS -X POST http://localhost:3001/api/tape/payment-success \
  -H 'content-type: application/json' \
  -d '{"session_id":"smoke-1","adults":2,"total":95}'
# → {"ok":true,"kind":"bp03b.payment_succeeded","session_id":"smoke-1","idempotent":false}
```

### Known limits (scaffold)

- Idempotency cache is in-process only — a server restart resets the dedupe set.
- No Stripe webhook, no charge, no refund — these are BP-08.
- `actor` is hard-coded to `"tenant"` for both beacons.

---

## BP-08 Stripe Payments (operator-facing)

Real Stripe PaymentIntents wiring. Replaces the BP-03b fake-submit path once
`STRIPE_LIVE_ENABLED=true`. Full implementation contract lives in
[`bp-08-stripe-spec.md`](bp-08-stripe-spec.md); this section is the operator
playbook for cutover, key rotation, DLQ replay, idempotency verification, and
rollback.

### Initial setup (one-time)

- Stripe Dashboard → Developers → Webhooks → add endpoint
  - URL: `https://api-production-ed89.up.railway.app/api/payments/webhook`
  - Events: `payment_intent.succeeded`, `payment_intent.payment_failed`
  - Copy the signing secret → set Railway env `STRIPE_WEBHOOK_SECRET`
- Stripe Dashboard → Developers → API Keys → reveal Secret key
  → set Railway env `STRIPE_SECRET_KEY` (`sk_live_*` for prod, `sk_test_*` for staging)
- Publishable key → `STRIPE_PUBLISHABLE_KEY` (`pk_live_*` / `pk_test_*`)
- Verify `.env.example` is current.

### Production cutover (`STRIPE_LIVE_ENABLED=true`)

Pre-flight checklist (mirrors [`bp-08-stripe-spec.md §8.1`](bp-08-stripe-spec.md#81-flip-criteria-production)):

1. All keys above set on Railway? `railway variables --json | jq '.STRIPE_*'`
2. Webhook secret matches the dashboard? Test with `stripe listen` locally first.
3. Boot guard catches misconfig? Trigger by setting `STRIPE_LIVE_ENABLED=true`
   with `STRIPE_SECRET_KEY=sk_test_changeme` — Railway should crash-loop
   until you fix it. Roll back the flag flip.
4. End-to-end: $1 test transaction via Stripe Dashboard manual capture.
5. Flip `STRIPE_LIVE_ENABLED=true`, redeploy.

### Key rotation

- Generate new secret in Stripe Dashboard.
- Set new key in Railway (paste into `STRIPE_SECRET_KEY` var).
- Railway will redeploy automatically (~90s downtime acceptable for key rotation).
- Revoke old key in Stripe Dashboard **only after** new deploy is verified.
- For webhook secret: same procedure, but verify a test webhook fires
  between old-revoke and new-active to confirm no gap.

### DLQ replay (when webhook handler fails)

The `stripe_webhook_dlq` table (see [`bp-08-stripe-spec.md §5.4`](bp-08-stripe-spec.md#54-dead-letter-table-optional-but-recommended))
captures any webhook event whose handler threw. Replay procedure:

```sql
SELECT * FROM stripe_webhook_dlq
WHERE attempt_count < 5
  AND last_failed_at > NOW() - INTERVAL '24 hours'
ORDER BY last_failed_at;
```

For each row:

1. Identify the bug from `error_message`, fix the dispatch code.
2. Replay via Stripe: `stripe events resend evt_<event_id>` (`event_id` from the DLQ row).
3. After successful replay: `DELETE FROM stripe_webhook_dlq WHERE event_id = '<id>';`

### Idempotency replay verification

Run this after every prod deploy that touches `src/modules/payment/`:

- Pick an `applicationId` with a recent successful payment.
- `curl -X POST $API/api/payments/intents -H 'Authorization: Bearer $TOKEN'
   -d '{"applicationId":"<id>","amountCents":50000,"attemptN":1}'`
- First call: `201` + new `clientSecret`.
- Second call (same body): `200` + **same** `clientSecret` (replay).
- Third call (`attemptN: 1`, but original PI is succeeded): `409` + `replay_blocked`.

If the second call returns a different `clientSecret`, the persistent
idempotency layer is broken — page engineering before letting more traffic in.

### Rollback procedure

- Set `STRIPE_LIVE_ENABLED=false` on Railway → redeploy.
- `VITE_PAYMENT_WIZARD_ENABLED=false` (already default) — client hides pay UI.
- In-flight PaymentIntents remain valid on Stripe side; they'll either
  succeed or auto-cancel after 7 days (Stripe default). No action needed.
- Webhooks continue arriving while flag is off; idempotency keeps them
  correct. No DLQ growth expected from this rollback.
