# ledger

## Purpose

The per-tenant rent ledger: charges, payments, late fees, credits, adjustments — the
single source of truth for a tenant's running balance. Encodes the operator's actual
late-fee policy and the delinquency pattern that triggers eviction sequencing. (Note:
single-entry per tenant — the company-level GL is a separate, not-yet-built module;
see DM-FRANK-025.)

## Workflow encoded

1. **Monthly rent posting** — `postMonthlyRent()` creates a `rent_charge` entry,
   idempotent per `billing_period`.
2. **Late-fee auto-assessment** — `processLateFees()` (daily): grace period 5 days,
   then $50 base + $10/day capped at 30 days.
3. **Payment recording** — the Stripe `payment_intent.succeeded` webhook calls
   `recordPayment()` → `payment` entry + balance update.
4. **Balance** — `getBalance()` = SUM of all `posted` entries (signed amounts).
5. **Reversal** — `reverseEntry()` flips status to `reversed` and creates the
   offsetting entry with a required reason (append-only correction style).
6. **Eviction trigger** — 4 late payments inside a rolling 12 months trips the
   eviction-notice pathway.

Policy constants (in `service.ts`): `GRACE_PERIOD_DAYS=5`, `BASE_LATE_FEE=$50`,
`DAILY_LATE_FEE=$10`, `MAX_LATE_FEE_DAYS=30`, `AUTO_PAY_DISCOUNT=$25/mo`,
`EVICTION_TRIGGER_COUNT=4`.

## Data model

`tenant_ledger`: `entry_type` enum (`rent_charge`, `late_fee`, `nsf_fee`, `payment`,
`credit`, `concession`, `adjustment`, `pro_rated_rent`, `extended_guest_fee`,
`early_termination_fee`, `refund`), `status` (`posted`/`reversed`/`pending`), signed
`amount`, `balance_after`, `billing_period` (YYYY-MM), `due_date`, `reference_id`
(Stripe PI), `posted_by`, `reversed_by_id` (FK to the reversing entry).
Indexes on application, property, billing_period, entry_type, due_date.

## API surface

| Route | Permission |
|---|---|
| `GET /api/ledger/:applicationId` | `ledger:view` (filters: billingPeriod, entryType, paging) |
| `GET /api/ledger/:applicationId/balance` | `ledger:view` |
| `POST /api/ledger/post-rent` | `user:manage` (manual monthly posting trigger) |
| `POST /api/ledger/process-late-fees` | `user:manage` |
| `POST /api/ledger/entry/:entryId/reverse` | `ledger:manage` (reason required) |
| `GET /api/ledger/delinquencies` | `ledger:view` |
| `GET /api/ledger/showcase` | `ledger:view` (stakeholder snapshot — "The Ledger" page) |

Routing hazard: the static routes must stay declared before the `/:applicationId`
dynamic route.

## Compliance anchors

Audit actions: `ledger_rent_posted`, `ledger_payment_recorded`,
`ledger_late_fee_assessed`, `ledger_credit_applied`, `ledger_entry_reversed`.
Nevada late-fee statute: grace period + fee cap encoded. HUD sequencing: late-payment
pattern feeds the eviction module.

## Flags & env

None module-specific; inherits property-scope RBAC.

## Current state

**Live.** Late fees, delinquency reports, balances, reversals all operational.
Gap: monthly rent posting has no automated trigger yet (manual `POST /post-rent`);
late-fee config is hardcoded constants, and the $50+$10/day policy vs HUD lease terms
is an open decision in the fleet queue.

## Key files

`src/modules/ledger/service.ts`, `src/modules/ledger/routes.ts`.
