# decision-matrix

## Purpose

Lease-modification requests with the same tiered, separation-of-duties approval spine
as applications: a leasing agent requests a change (rent, term, occupant), and it
climbs senior → regional → asset approval without any single person owning the
decision end to end.

## Workflow encoded

`pending_tier1 → tier1_approved/denied → … → approved | denied`, role-gated per tier
(tier 1 senior+, tier 2 regional+, tier 3 asset+), with
`enforceSeparationOfDuties(actor, previousActors)` blocking repeat actors.

## Data model

`lease_modifications`: `modification_type` enum, original vs requested values, status
machine, per-tier decided_by/decision/notes/decided_at, requester + role.

## API surface

| Route | Permission |
|---|---|
| `POST /api/decision-matrix/:applicationId` | `modification:request` (leasing+) |
| `POST /api/decision-matrix/decide/:modificationId` | tier-mapped `modification:approve_*` |
| `GET /api/decision-matrix/:applicationId` | `lease:modify` |

## Compliance anchors

Separation of duties; decisions audit-logged
(`lease_modification_requested/approved/denied`).

## Flags & env

None.

## Current state

**Live**, basic. Gap: no dedicated tape stamps yet (audit_log only).

## Key files

`src/modules/decision-matrix/{routes,service}.ts`.
