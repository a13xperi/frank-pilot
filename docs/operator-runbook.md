# Operator Runbook

Operational reference for Frank-Pilot CDPC operators.

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
