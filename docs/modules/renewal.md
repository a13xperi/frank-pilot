# renewal

## Purpose

Lease renewal offers, tenant responses (accept / decline / counter), and final approval
with term extension. Auto-generates offers 90 days before lease end (3% increase) and
nags at 60/30 days.

## Workflow encoded

1. **Offer** — `generateOffer()`: renewal row `offered`, SMS with proposed rent +
   response deadline (30 days before lease end).
2. **Respond** — `respond()`: tenant `accept` / `decline` / `counter`
   (counter carries `counter_rent` + `counter_term_months`).
3. **Approve** — `approve()`: staff confirms; updates `applications.lease_end_date` +
   `requested_rent_amount`; status `approved`.
4. **Auto-generate + remind** — daily `processRenewalOffers()` (07:30): creates offers
   for leases ending within 90 days; sends 60/30-day reminders.

Statuses: `pending_offer → offered → accepted | declined | counter_offered → approved | expired`.

## Data model

`lease_renewals`: status machine above, `current_rent`, `proposed_rent`,
`rent_change_amount`, `proposed_term_months`, `tenant_response`, counter fields,
offered/response/deadline timestamps, `approved_by`, reminder timestamps.

## API surface

| Route | Permission |
|---|---|
| `GET /api/renewals` (+ `/:id`) | `renewal:view` |
| `POST /api/renewals` | `renewal:manage` |
| `POST /api/renewals/:id/respond` | `renewal:manage` |
| `POST /api/renewals/:id/approve` | `renewal:manage` |
| `POST /api/renewals/process` | `user:manage` (manual scheduler trigger) |

## Compliance anchors

Audit stamps: `renewal_offered`, `_accepted`, `_declined`, `_counter_offered`,
`_approved`. No HUD mandate (state notice rules vary).

## Flags & env

None module-specific.

## Current state

**Live.** Gaps: approved renewals don't post rent adjustments to the ledger; no
auto-pay late-fee waiver logic on renewal.

## Key files

`src/modules/renewal/service.ts`, `src/modules/renewal/routes.ts`.
