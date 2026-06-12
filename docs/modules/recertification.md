# recertification

## Purpose

HUD §42 LIHTC annual/interim income recertification. Tracks anniversary and cutoff
dates, the TRACS submission deadline, the 140%-AMI income ceiling, and the Next
Available Unit (NAU) obligation on over-income units — with automated reminders and
market-rent enforcement for non-responders.

## Workflow encoded

1. **Create on onboarding** — `createForApplication()`: anniversary = lease start + 1yr;
   cutoff = anniversary − 1 month (day 10); TRACS deadline = anniversary + 15 months.
2. **Remind** — daily `processReminders()`: SMS at 120/90/60 days; mark overdue past
   cutoff; apply market rent past anniversary while overdue.
3. **Submit** — `submit()` records `new_annual_income` → `submitted`.
4. **Review** — `approveRecertification()` computes `income_ceiling_verdict`
   (`not_restricted` / `qualified` / `over_income_aur` / `over_income` /
   `indeterminate`) from the unit's `ami_designation` + 140% threshold + household size;
   sets `rent_adjustment`.
5. **NAU rule** — over-income (>140%) opens `nau_status='open'`; `satisfied` when a
   comparable unit rents to a qualifying household; `lost` → market rent.

Statuses: `pending → reminder_120 → reminder_90 → reminder_60 → submitted →
under_review → approved | denied | overdue | market_rent_applied`.

## Data model

`recertifications`: type (`annual`/`interim`), the status machine above, anniversary /
cutoff / TRACS dates, reminder timestamps, previous/new income, `rent_adjustment`,
market-rent fields, `income_ceiling_*` columns (verdict CHECK, designation, limit,
income, checked_at), `nau_*` columns (status, resolved_at, resolving_unit_id FK).

## API surface

| Route | Permission |
|---|---|
| `GET /api/recertifications` (+ `/upcoming`, `/:id`, `/:id/income-check`) | `recertification:view` |
| `POST /api/recertifications` | `recertification:manage` |
| `POST /api/recertifications/:id/submit` | `recertification:manage` |
| `POST /api/recertifications/:id/approve` | `recertification:manage` |

## Compliance anchors

HUD §42(g)(1) annual recertification · §42(g)(2)(D)(ii) 140% rule + NAU ·
market-rent enforcement when overdue. Audit stamps: `recertification_created`,
`_reminder_sent`, `_submitted`, `_approved`, `_denied`, `_overdue`,
`market_rent_applied`, `recertification_reset`.

## Flags & env

`RECERT_INCOME_CEILING_ENABLED` (ceiling verdicts) · `RECERT_NAU_RULE_ENABLED`
(NAU tracking) · Twilio for SMS reminders.

## Current state

**Live** — reminders, ceiling enforcement, NAU tracking operational. Gap: no automated
rent-adjustment posting to the ledger after `market_rent_applied`.

## Key files

`src/modules/recertification/service.ts`, `src/modules/recertification/routes.ts`.
Scheduler: reminders daily 08:00; TRACS check daily 09:00 (`src/scheduler.ts`).
