# maintenance

## Purpose

Work-order lifecycle with emergency triage: tenants submit maintenance requests (with
photos + timestamps), staff assign, work, and complete them; life-safety categories
auto-flag as emergencies.

## Workflow encoded

`submitted → assigned → in_progress → completed | cancelled | on_hold`.
Emergency auto-detection: `priority='emergency'` OR category in the emergency set
(plumbing_leak, frozen_pipes, no_heat, gas_leak, flooding, lock_change_safety, …) →
`is_emergency=true` + WARN-level ops alert.

## Data model

`work_orders`: property/application FKs, `unit_number`, `priority`
(`emergency`/`urgent`/`routine`/`low`), status machine above, `category`,
`is_emergency`, assignment fields (`assigned_to/_at`), completion fields
(`completed_by`, `completion_notes`, `actual_cost`), `photos` JSONB,
`estimated_cost`.

## API surface

| Route | Permission |
|---|---|
| `POST /api/maintenance/work-orders` | `maintenance:manage` (note: leasing agents included) |
| `PATCH .../:id/assign` `/start` `/complete` `/cancel` | `maintenance:manage` |
| `GET /api/maintenance/work-orders` (+ `/:id`) | `maintenance:view` |

Tenant submission surface: `POST /api/tenant/work-orders` (ownership-scoped).

## Compliance anchors

Audit actions `work_order_created/assigned/completed`. Fair-housing relevance:
assignment + completion are audit-logged (responsiveness disparity is a
discrimination risk).

## Flags & env

None.

## Current state

**Live.** Gaps: `photos` is a JSONB field with **no upload pipeline behind it** (same
gap as Lozillo photos); no cost-approval workflow above a threshold.

## Key files

`src/modules/maintenance/{service,routes}.ts`.
