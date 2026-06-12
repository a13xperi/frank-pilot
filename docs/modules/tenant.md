# tenant

## Purpose

The tenant portal API: dashboard, rent ledger view, maintenance submission, messaging,
and the recertification/renewal/move-out touchpoints — everything a housed tenant
does, scoped hard to their own applications.

## Workflow encoded

Every route filters by `scopedApplicationIds` (applications joined through
`user_applications` for the authenticated user) — tenants see all their own units and
nothing else. Dashboard aggregates: active application, balance + next due date, open
work orders, recent ledger, lease status, recertification + renewal status.

## Data model

Owns no tables — reads `applications`, `tenant_ledger`, `work_orders`,
`application_messages`, `recertifications`, `lease_renewals`, `move_outs` through the
ownership join.

## API surface

All authenticated, tenant/applicant role, email-verified:
`GET /api/tenant/me` · `GET /api/tenant/dashboard` · `GET /api/tenant/ledger` ·
`POST /api/tenant/work-orders` · `GET /api/tenant/work-orders` ·
`GET/POST /api/tenant/me/messages` · `GET /api/tenant/recertification`.
Phase 7/8 surfaces (recert submit, renewal respond, moveout view) are schema-ready
stubs.

## Compliance anchors

Ownership-scope enforcement is the control; state-changing actions audit-log via
their owning modules.

## Flags & env

None.

## Current state

Dashboard, ledger view, work orders, messaging **live**. Recert submission, renewal
response, and move-out surfaces pending. No payment UI here — payments run through
the [payment](payment.md) module's Stripe Elements flow.

## Key files

`src/modules/tenant/routes.ts` (+ ledger/maintenance services it calls).
