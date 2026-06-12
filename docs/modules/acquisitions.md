# acquisitions

## Purpose

The LIHTC credit-acquisition side: QAP demand evidence from the live funnel, candidate
project scoring, award tracking, and the Phase-3 compliance bridge that binds awards
to managed properties and drives per-unit AMI designations under the LURA.

## Workflow encoded

1. **Demand (Phase 1)** — `getDemand()` rolls up live funnel applications by
   geographic account × bedrooms × AMI tier; `getDemandPacket()` packages it for a
   9%/4% credit application's market-study evidence.
2. **Projects (Phase 2)** — CRUD candidate projects (election kind, unit mix by tier,
   QCT/DDA, set-asides, resident services); scoring vs the funnel-relevant QAP subset.
3. **Awards + compliance (Phase 3)** — record reservations, bind award → property,
   **apply per-unit AMI designations atomically** with LURA commitment validation
   (designated units must cover the committed set-aside), surface the AUR queue
   (over-income recertifications eligible for Available-Unit-Rule action).

## Data model

`acq_projects` (election CHECK `STD_40_60`/`STD_20_50`/`AVERAGE_INCOME`, unit-mix
counts, QCT/DDA flags) · `acq_awards` (UNIQUE per project; status
`reserved`/`placed_in_service`/`in_service`/`closed`; binding `property_id`) ·
`units.ami_designation` (30/50/60/market) · reads `recertifications.income_ceiling_*`
for the AUR queue.

## API surface

`GET /api/acquisitions/demand` (+ `/packet`) · projects CRUD + `/:id/score` ·
awards CRUD + `/:id/bind`, `/:id/plan`, `/:id/units`, `/:id/designations` (atomic),
`/:id/compliance` · `GET /api/acquisitions/aur-queue` —
all `acquisition:view`/`acquisition:manage` (asset_manager + system_admin only),
portfolio-scoped.

## Compliance anchors

Stamps: `acq.award_recorded` (IRC §42 + NV QAP §3), `acq.units_designated`
(IRC §42(g) + 26 CFR 1.42-5 LURA), `acq.recert_income_checked`
(§42(g)(2)(D)(ii) AUR), `acq.nau_triggered/satisfied/lost`.
LURA validation enforced in `applyDesignations()`.

## Flags & env

None; gated by role.

## Current state

Demand + awards/designations/AUR **live**; project scoring in development.

## Key files

`src/modules/acquisitions/` — `routes.ts`, `demand-service.ts`,
`project-service.ts`, `award-service.ts`, `aur-queue-service.ts`.
