# moveout

## Purpose

Notice-to-vacate through deposit disposition: inspections, deduction math, the Nevada
21-day deposit-return deadline, refund execution with a ledger entry, and automatic
collections referral at 45 days.

## Workflow encoded

State machine (`moveout_status`): `notice_received → pre_inspection_scheduled →
pre_inspection_complete → vacated → final_inspection_complete → deposit_calculated →
deposit_sent → closed | collections`.

1. **Initiate** — expected vacate = notice + 30 days; deposit deadline = vacate + 21
   days (NV §118A.242); SMS to tenant.
2. **Inspections** — `recordInspection('pre'|'final')` uses **conditional UPDATE
   (`WHERE status = ANY(...)`)** so state transitions are atomic — no TOCTOU.
3. **Deposit math** — `calculateDeposit()`: deductions detail (JSONB item→cost) +
   unpaid rent from the ledger → refund amount.
4. **Refund** — `sendRefund()` (atomic from `deposit_calculated` only): posts a ledger
   credit, SMS with the amount.
5. **Collections** — 45 days post-vacate with unpaid rent → auto-refer.

## Data model

`move_outs`: status machine, notice/vacate/inspection dates + notes,
`deposit_amount`, `deductions_total`, `deductions_detail` JSONB, `refund_amount`,
`deposit_deadline`, `unpaid_rent_balance`, `collections_referred_at`,
`forwarding_address`.

## API surface

| Route | Permission |
|---|---|
| `POST /api/moveouts` | `moveout:manage` |
| `POST /api/moveouts/:id/inspection` | `moveout:manage` |
| `POST /api/moveouts/:id/deposit` | `moveout:manage` |
| `POST /api/moveouts/:id/refund` | `moveout:manage` |
| `GET /api/moveouts` | `moveout:view` |
| `POST /api/moveouts/process` | `user:manage` (collections sweep) |

## Compliance anchors

NV §118A.242 — `DEPOSIT_RETURN_DAYS=21` hardcoded; `COLLECTIONS_REFERRAL_DAYS=45`.
Audit stamps: `moveout_initiated`, `moveout_inspection_completed`,
`deposit_disposition_calculated`, `deposit_refund_sent`, `collections_referred`.

## Flags & env

None module-specific.

## Current state

**Live** end to end, including the ledger credit on refund. Gap: collections referral
is recorded but not integrated with any external collections agency.

## Key files

`src/modules/moveout/service.ts`, `src/modules/moveout/routes.ts`.
