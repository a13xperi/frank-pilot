# inspections

## Purpose

Unit inspection scheduling and recording — move-in/move-out, monthly, annual, HQS
(Section 8 Housing Quality Standards), emergency, and smoke-detector checks, with
room-level detail and follow-up flags.

## Workflow encoded

`scheduled → notice_sent → in_progress → completed | cancelled`; `overdue` derived at
query time (`scheduled_date < today` while still open). `complete()` records
`room_details`, `appliance_inventory`, `smoke_detector_ok`, `hqs_compliant`,
`follow_up_required` + notes.

## Data model

`inspections`: `inspection_type` enum (monthly/move_in/move_out/annual/emergency/
hqs/smoke_detector), status machine, scheduled/completed dates, `inspector_id`,
`room_details`/`photos`/`appliance_inventory` JSONB, HQS + smoke-detector booleans,
follow-up fields.

## API surface

| Route | Permission |
|---|---|
| `POST /api/inspections` | `inspection:manage` |
| `PATCH /api/inspections/:id/complete` `/cancel` | `inspection:manage` |
| `GET /api/inspections` (+ `/:id`, `/overdue`) | `inspection:view` |

## Compliance anchors

Audit actions `inspection_scheduled/completed`; `hqs_compliant` for Section 8;
`smoke_detector_ok` as the life-safety audit field.

## Flags & env

None.

## Current state

**Live.** Gaps: no photo upload pipeline; notice generation is manual
(`notice_sent_at` set by hand, no automated tenant notice).

## Key files

`src/modules/inspections/{service,routes}.ts`.
