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
