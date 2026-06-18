# Frank — Ledger White Paper: State, Code Commitment & Location

**Status snapshot as of 2026-06-17** · repo `frank-pilot` · `origin/main` @ `37d2efd` (Jun 12, PR #296)
**Question answered:** *Where is the ledger today, how committed is its code, and where does it live?*

---

## TL;DR — Verdict

| Layer | What it is | State | Code commitment |
|---|---|---|---|
| **Tenant Rent Ledger** | Per-tenant running balance (charges, payments, late fees, credits, reversals) | ✅ **LIVE** | **Fully committed to `origin/main`.** Working tree is byte-identical to main — nothing stranded on a branch, nothing uncommitted. On main since **2026-05-14**. |
| **Accounts Payable (AP)** | Check-writing / vendor invoices / approval chain | 📐 **DESIGN ONLY** | Spec committed, but **only on branch `feat/ap-design-doc-tenant-readme`** — not on main, not in the working tree. **Zero application code.** |
| **General Ledger (GL)** | Company/entity-level books, financial reporting | 🌑 **NOT BUILT** | No code, no spec doc. A named placeholder (**DM-FRANK-025**). |

**The thing people mean by "the Frank ledger" — the tenant rent ledger — is real, shipped, wired into the running app, and clean.** The AP and GL layers are not code; they are gated behind the **DM-FRANK-023** source-of-truth decision (RealPage-as-SOR vs. Frank-owns-financials).

---

## 1. Disambiguation — three things get called "the ledger"

1. **Tenant Rent Ledger** (`tenant_ledger`) — single source of truth for *one tenant's* running balance. **This is the live system** and the subject of §2–§6 below.
2. **Accounts Payable** (DM-FRANK-024) — outbound money (paying vendors). Design spec only (§7).
3. **Entity General Ledger** (DM-FRANK-025) — company-level double-entry books and financial statements. Not started (§7). Explicitly called out as *not* the tenant ledger in the module spec (`docs/modules/ledger.md:8-9`).

> The tenant rent ledger is **single-entry per tenant**, not a company-wide double-entry GL. That distinction is the whole of the DM-FRANK-025 gap.

---

## 2. Where it lives

**Repository:** `frank-pilot` (TypeScript / Express backend, React client, Postgres schema).

| Artifact | Path | Lines |
|---|---|---|
| Service logic | `src/modules/ledger/service.ts` | 956 |
| HTTP routes | `src/modules/ledger/routes.ts` | 260 |
| Module spec | `docs/modules/ledger.md` | 73 |
| Demo seed | `src/db/seed-demo-ledger.ts` | 198 |
| Table DDL | `src/db/schema.ts:1066` (`CREATE TABLE tenant_ledger`) | — |
| Indexes | `src/db/schema.ts:1240-1244` (application, property, billing_period, entry_type, due_date) | — |

**Wiring into the app (verified):**
- `src/index.ts:41` — `import ledgerRoutes from "./modules/ledger/routes";`
- `src/index.ts:378` — `app.use("/api/ledger", ledgerRoutes);`
- `routes.ts:5,9` — backed by a `LedgerService` class instance.

**Database table** (`src/db/schema.ts:1066`):
```sql
CREATE TABLE IF NOT EXISTS tenant_ledger (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  application_id  UUID NOT NULL REFERENCES applications(id),
  property_id     UUID NOT NULL REFERENCES properties(id),
  entry_type      ledger_entry_type NOT NULL,
  status          ledger_entry_status NOT NULL DEFAULT 'posted',
  description     TEXT NOT NULL,
  amount          DECIMAL(12,2) NOT NULL,
  balance_after   DECIMAL(12,2) NOT NULL DEFAULT 0,
  billing_period  VARCHAR(7),
  due_date        DATE,
  reference_id    VARCHAR(100),          -- Stripe payment-intent id
  posted_by       UUID REFERENCES users(id),
  reversed_by_id  UUID REFERENCES tenant_ledger(id),  -- append-only correction link
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
```
`entry_type` enum: `rent_charge`, `late_fee`, `nsf_fee`, `payment`, `credit`, `concession`, `adjustment`, `pro_rated_rent`, `extended_guest_fee`, `early_termination_fee`, `refund`. `status` ∈ {`posted`, `reversed`, `pending`}.

---

## 3. How committed the code is

**Fully committed and shipped. No loose ends.** Verified against a freshly-fetched `origin/main`:

- ✅ All three ledger files (`service.ts`, `routes.ts`, `ledger.md`) are **present on `origin/main`**.
- ✅ `git diff origin/main -- src/modules/ledger/ docs/modules/ledger.md` → **empty**. The working tree is identical to what is on the remote main branch. Nothing is mid-edit, nothing is divergent.
- ✅ The latest functional ledger commit (`f28f38d`, the showcase page) and the latest doc commit (`9e07df1`) are **both confirmed on `origin/main`**.
- ✅ The module is reachable from `main` and ~28 other branches (it predates them all — born in PR #2).
- ⚠️ Current checkout is branch `feat/phone-first-frank` (5 commits ahead of `origin/main`, 0 behind). **None of those 5 commits touch the ledger** — it is not under active modification.
- ⚠️ One untracked file exists in `src/db/migrations/` (`2026-06-14-waitlist-sequencing.sql`) — **unrelated to the ledger** (waitlist sequencing).

**Reproduce this verdict:**
```bash
git -C ~/code/frank-pilot fetch origin main
git -C ~/code/frank-pilot ls-tree -r --name-only origin/main -- src/modules/ledger/   # files exist on main
git -C ~/code/frank-pilot diff --stat origin/main -- src/modules/ledger/               # empty == in sync
git -C ~/code/frank-pilot branch -r --contains f28f38d | grep origin/main              # showcase on main
```

---

## 4. Commit timeline (every ledger-touching commit, all on `origin/main`)

| Commit | Date | What landed |
|---|---|---|
| `6f0439a` | 2026-05-14 | **Birth** — PR #2: tenant portal + applicant flow + eviction/**ledger**/recert modules |
| `481d99c` | 2026-05-23 | BP-08: decouple Stripe webhook livemode guard + prove the payment loop (#141) |
| `9791853` | 2026-05-24 | BP-08 hardening: receipt emails + Stripe refunds (#175) |
| `791bfea` | 2026-06-10 | Demo enrichment seed — populate the book for the Jun 11 demo |
| `f28f38d` | 2026-06-10 | **"The Ledger" stakeholder showcase page** + `GET /api/ledger/showcase` |
| `9e07df1` | 2026-06-12 | Module-reference docs pass (30 module docs) |

**Reading:** Core ledger has been on main for **~5 weeks**. Last *functional* change was the Jun 10 showcase endpoint; last touch of any kind was the Jun 12 docs pass. It is **mature and stable**, not a work-in-progress.

---

## 5. What the live ledger actually does

**API surface — 10 endpoints, all under `/api/ledger`, all RBAC-gated** (`routes.ts`):

| Method & route | Permission | Purpose |
|---|---|---|
| `GET /:applicationId` | `ledger:view` | Tenant entries (filters: billingPeriod, entryType, paging) |
| `GET /:applicationId/balance` | `ledger:view` | Current balance (Σ of posted signed amounts) |
| `GET /delinquencies` | `ledger:view` | Delinquency report (property-scoped) |
| `GET /showcase` | `ledger:view` | "The Ledger" stakeholder snapshot |
| `POST /post-rent` | `user:manage` | Manual monthly rent posting trigger |
| `POST /process-late-fees` | `user:manage` | Run daily late-fee assessment |
| `POST /:applicationId/payment` | `ledger:manage` | Record a payment |
| `POST /:applicationId/credit` | `ledger:manage` | Apply a credit |
| `POST /:applicationId/charge` | `ledger:manage` | Manual charge (late_fee / nsf / guest / termination / adjustment) |
| `POST /entry/:entryId/reverse` | `ledger:manage` | Reverse an entry (reason required, append-only) |

**Service methods** (`LedgerService`): `getLedger`, `getBalance`, `getDelinquencyReport`, `getShowcase`, `processMonthlyRentPostings`, `processLateFees`, `recordPayment`, `applyCredit`, `postCharge`, `reverseEntry`.

**Policy encoded** (constants in `service.ts`): `GRACE_PERIOD_DAYS=5`, `BASE_LATE_FEE=$50`, `DAILY_LATE_FEE=$10`, `MAX_LATE_FEE_DAYS=30`, `AUTO_PAY_DISCOUNT=$25/mo`, `EVICTION_TRIGGER_COUNT=4` (4 late payments in a rolling 12 months trips the eviction-notice pathway). Nevada late-fee statute (grace + cap) and HUD delinquency sequencing are baked in.

**Integrity model:** append-only. Corrections are made by `reverseEntry()` (flips status → `reversed`, writes an offsetting entry, links via `reversed_by_id`, requires a reason) rather than mutation. Payments flow in from the Stripe `payment_intent.succeeded` webhook. Audit actions emitted: `ledger_rent_posted`, `ledger_payment_recorded`, `ledger_late_fee_assessed`, `ledger_credit_applied`, `ledger_entry_reversed`.

---

## 6. Known gaps (honest)

From `docs/modules/ledger.md` "Current state" — all are *policy/automation* gaps, not missing code:

1. **No automated monthly posting.** Rent posting is a manual `POST /post-rent`; there is no cron/scheduler firing it yet.
2. **Hardcoded fee config.** Late-fee constants live in `service.ts`, not in per-property config.
3. **Open policy decision.** The $50 + $10/day late-fee schedule vs. actual HUD lease terms is an unresolved item in the fleet queue.

---

## 7. The sibling ledgers (not built) and the gate

### Accounts Payable — DM-FRANK-024 · DESIGN ONLY
- **Doc:** `docs/modules/accounts-payable.md`, commit `eafdf8a` (2026-06-16).
- **Location:** branch **`feat/ap-design-doc-tenant-readme`** only (also on its origin remote). **Not on `origin/main`, not in the working tree.**
- **Code:** none. Proposed tables (`ap_vendors`, `ap_invoices`, `ap_checks`, `ap_check_runs`, `ap_approvals`) are unmigrated. Estimated 36–72h to build once unblocked.

### General Ledger — DM-FRANK-025 · NOT BUILT
- No code, no spec file — only a named reference in `docs/modules/ledger.md:8-9`. Company-level books / financial statements / tax reporting.

### The blocker: DM-FRANK-023 (PENDING)
Both AP and GL are frozen on the "gravity center" source-of-truth decision:

| Option A (current CFO lean) | Option B |
|---|---|
| RealPage/OneSite stays financial SOR; Frank = capture + approval + audit layer | Frank owns AP **and** GL end-to-end |
| Cheaper, parallel-run validation first | Audit-native, no external dependency, riskier |

Until DM-FRANK-023 is called, the **tenant rent ledger keeps running**, AP stays a spec, and GL stays dark.

---

## Appendix — provenance & method

This white paper was produced by reading the code and verifying against a freshly-fetched remote, not from memory. Anchors:
- `origin/main` HEAD: `37d2efd` "Merge PR #296 docs/meridian-teardown" (2026-06-12).
- Working branch at time of writing: `feat/phone-first-frank` (+5 / -0 vs main; no ledger commits among the +5).
- Every status claim in §3–§4 is reproducible with the commands in §3.

*Generated 2026-06-17. Snapshot — re-verify against `origin/main` before relying on the commitment claims for an external (e.g. lender/CFO) audience.*
