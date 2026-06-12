# tape

## Purpose

The immutable, hash-chained compliance tape — the platform's audit spine and the
substance behind "any unit set, fully audited, in about ninety seconds." Every
regulated event (fair-housing postings, payments, screening decisions, voice calls,
lease execution) lands here with a legal citation, a SHA-256 chain proof, and a
Postgres trigger that physically rejects mutation.

## Workflow encoded

**Stamping (Lane B, Postgres):** `stamp()` reads the chain tail, computes
`entry_hash = SHA-256(sequence ‖ prev_hash ‖ canonicalJson(payload) ‖ created_at)`
and inserts atomically. Sequence collisions retry up to 3×. Idempotent on
`(kind, session_id)` via `ON CONFLICT DO NOTHING`. `GENESIS_HASH` = 32 zero bytes;
sequence is big-endian uint64 and monotonic **per scope** (per applicant, or global);
`canonicalJson` = lexicographically sorted keys, no whitespace (RFC 8785-ish).

**Verification (Lane D):** `verify()` walks the full chain — sequence monotonicity +
every `prev_hash == prior entry_hash` — O(n), sub-second for a typical tenant.
`exportPdf()` produces a printout, 50 entries/page, with a rolling hash in each footer
so the paper itself is self-verifying.

**Dual-write (Lane G):** `stampV2*()` wrappers fire alongside the legacy NDJSON
`stampTape()` when `COMPLIANCE_TAPE_V2_ENABLED=true`. v2 errors are logged and
swallowed — a tape outage must never block an applicant.

**Legacy (Lane A):** NDJSON files `server/tape/bp03b.ndjson` and `bp08.ndjson`,
one JSON object per line — still the production source of truth until the v2 flag flips.

## Data model

`compliance_tape`: `sequence` (CHECK ≥ 1, gapless per scope via
`COALESCE(applicant_id, sentinel)` unique index), `kind`, `citation`,
`applicant_id` (NULL = global scope), `payload` JSONB, `prev_hash` BYTEA(32),
`entry_hash` BYTEA(32) UNIQUE, `session_id` (idempotency), `created_at`.
**Triggers `compliance_tape_no_update` / `no_truncate` raise EXCEPTION on any
UPDATE/DELETE/TRUNCATE.** Failures queue in `compliance_tape_dlq`.

## API surface

| Route | Permission |
|---|---|
| `POST /api/tape/welcome-view`, `/welcome-accept` | public, rate-limited 30/min/IP |
| `POST /api/tape/payment-init`, `/payment-success` | public, rate-limited (BP-03b scaffold) |
| `GET /api/compliance-tape?applicantId=…[&afterSequence=N]` | `audit:view` |
| `GET /api/compliance-tape/verify?applicantId=…` | `audit:view` → `{ok, brokeAt, reason}` |
| `GET /api/compliance-tape/export?applicantId=…` | `audit:view` → PDF stream |

## Compliance anchors

70+ stamp kinds with citations in `TAPE_CITATIONS`, e.g.:
`WELCOME_LETTER_DELIVERED` (HUD 4350.3 Ch. 4-4) · `HUD_928_1_FAIR_HOUSING_POSTED`
(24 CFR Part 110) · `WAITING_LIST_APP_CAPTURED` (HUD 4350.3 Ch. 4-6) ·
`POSITION_LETTER_SENT` (Ch. 4-14 + 4-16) · `LEASE_EXECUTED` (ESIGN/UETA) ·
`VOICE_INTAKE_COMPLETED` (Ch. 4-6 / NRS 200.620 two-party consent) ·
`VOICE_INTAKE_OUTBOUND_ATTEMPTED` (TCPA 47 CFR §64.1200(a)(2)) ·
the `BP08_PAYMENT_*` suite (Ch. 4-6).

## Flags & env

- `COMPLIANCE_TAPE_V2_ENABLED` — gates the Postgres dual-write. **Default false.**
- `TAPE_LEDGER_PATH` / `BP08_LEDGER_PATH` — NDJSON path overrides (tests).
- In-process `(kind, session_id)` dedupe set guards double-stamps per process lifetime.

## Current state

Lane A (NDJSON) **live** and authoritative. Lane B (hash-chain) implemented + tested,
**flag-dark in prod**. Lane D viewer/verify/PDF ready. Gaps: global-scope reads return
501 (v1 implements applicant-scoped only); **no correction-addendum block concept yet** —
the tape is pure append (the demo-narrative "append-only addendum corrections" is a
roadmap item); cutover requires `COMPLIANCE_TAPE_V2_ENABLED` + post-deploy dual-write
verification.

## Key files

`src/modules/tape/` — `index.ts` (legacy + stamp kinds), `service.ts` (Lane B),
`hashing.ts`, `repository.ts`, `v2-stamp.ts`, `routes.ts`, `routes-viewer.ts`,
`dlq.ts`, `types.ts`.
