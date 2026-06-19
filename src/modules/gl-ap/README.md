# gl-ap — Entity-level GL/AP ledger (B3): generic double-entry foundation

This module is the **GENERIC, config-driven foundation** of the entity-level
general-ledger / accounts-payable system (build-list **B3**, gravity center
**DM-FRANK-023**). It implements everything that is **universal to any
double-entry GL/AP** and leaves every entity-specific decision as **DATA** that
slots in from Tanya's 8-step intake (`docs/deals/TANYA-GL-INTAKE.md`) — no
rebuild required.

> This is distinct from `src/modules/ledger` (the tenant accounts-**receivable** /
> rent ledger, `tenant_ledger`). This is the entity-level **general** ledger —
> the books an accountant closes each month. It is also distinct from the
> in-flight `src/modules/accounts-payable` check-cutting state machine
> (DM-FRANK-024); the two compose (a bill reaches `scheduled` → a check is cut).

## What's here (all generic, all tested)

| File | Role | Pure? |
|---|---|---|
| `types.ts` | Shared types (accounts, entries/lines, bills/payments, posting rules, reconciliation) | n/a |
| `posting.ts` | Double-entry engine: `postJournalEntry` (**rejects unbalanced**), `deriveBalances`, `computeTieOut`, `periodClose`. Works in integer cents — exact. | ✅ pure |
| `ap-state-machine.ts` | AP **bill** lifecycle: `draft→submitted→approved→scheduled→partially_paid→paid`, `+reject/void`, `settlePaymentState` | ✅ pure |
| `posting-rules.ts` | **Config-driven** `PostingRule` loader + `applyPostingRule` (source-doc-type → Dr/Cr). **This is exactly where Tanya's 8 steps go.** | ✅ pure |
| `reconciliation.ts` | Parallel-run shadow-vs-source reconciliation report | ✅ pure |
| `service.ts` | DB-backed orchestration over the pure engine (posting, AP workflow, period close, shadow reconcile). Reuses repo `config/database`. | DB |
| `config/*.placeholder.json` | **PLACEHOLDER** chart of accounts + posting rules (standard textbook set; NOT Frank/GPM's real data) | data |
| `../../db/migrations/2026-06-18-gl-ap-foundation.sql` | Schema: `gl_entities`, `gl_books`, `gl_chart_of_accounts`, `gl_periods`, `gl_journal_entries`, `gl_journal_lines`, `gl_account_balances`, `ap_vendors`, `ap_bills`, `ap_payments`, `gl_parallel_run_reports`. Idempotent. Balance enforced by a deferred CONSTRAINT TRIGGER. | DDL |

Balance (`Σdebits = Σcredits`) is enforced **twice**: in code
(`postJournalEntry` throws `UnbalancedEntryError` before any write) and in the DB
(deferred constraint trigger `trg_gl_lines_balanced`). Shadow-mode entries are
persisted but **never** counted toward live balances or a period close.

## What is a PLACEHOLDER (must be replaced before go-live)

Everything entity-specific is config/data, clearly marked `PLACEHOLDER — replace
from TANYA-GL-INTAKE`:

- `config/chart-of-accounts.placeholder.json` + the seeded rows in the migration
  (`is_placeholder = TRUE`, under `PLACEHOLDER-BOOK`).
- `config/posting-rules.placeholder.json` — the Dr→Cr rule set.

## Go-live checklist — what's still needed from Tanya's intake

The foundation is built and tested. To run for real, supply the DATA from
`docs/deals/TANYA-GL-INTAKE.md`:

1. **Chart of accounts (Part 2)** — Tanya's real account list + numbering.
   Replace `config/chart-of-accounts.placeholder.json` (or load a per-book file),
   set `placeholder: false`, and purge the seeded `is_placeholder` rows.
2. **The 8 posting rules (Part 1)** — transcribe each step's "Journal entry
   (Debit → Credit acct)" into `config/posting-rules.placeholder.json`: one rule
   per source-doc-type, pointing `debitAccount`/`creditAccount` at her real
   codes. Set `placeholder: false`.
3. **Entity/book structure (Part 2)** — which legal entities/properties post to
   which book; per-property vs consolidated. Insert `gl_entities` + `gl_books`
   rows (and `gl_book_consolidation_members` for roll-ups).
4. **AP workflow specifics (Part 2)** — confirm the bill state machine + the
   approval/SoD rules against Tee's captured AP workflow; wire the real approver
   roles in the service layer.
5. **Recurring entries (Part 2)** — accruals/allocations/intercompany/
   depreciation: add as posting rules or scheduled entries (not yet built — out
   of B3's generic scope).
6. **Period-close checklist (Part 2)** — the tie-outs that must pass before lock
   (beyond the trial-balance check already enforced).
7. **Parallel-run scope + start (Part 2 / DM-FRANK-023)** — which entity/property
   and which month to run in **shadow** mode alongside today's system, plus the
   source-of-record export to feed `reconcileShadow`.

## DDL_PENDING

`src/db/migrations/2026-06-18-gl-ap-foundation.sql` is **not yet applied** to any
database. Apply with `npm run migrate` (or psql) against the target. The fleet
`.env` carries no DDL creds, so this is apply-by-Alex on the chosen DB.

## Validation

- `npx tsc --noEmit` — clean.
- `npx jest src/modules/gl-ap` — 5 suites, 69 tests (balance enforcement +
  property tests, posting, AP state machine, config-rule application, parallel-run
  reconciliation, service orchestration).
