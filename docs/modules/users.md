# users

## Purpose

Staff user management (create/activate/deactivate/reset), signup statistics, and the
tenant self-serve password path — which is deliberately *not* a password: tenants are
magic-link-only (`password_hash` NULL).

## Workflow encoded

System admin creates staff with role + property scope; senior+ can view/list; admins
reset staff passwords directly; tenants request a magic-link reset email
(3/min rate limit) — staff are 403'd off the tenant path.

## Data model

`users`: `email` UNIQUE, `password_hash` (nullable — magic-link users), `role` enum
(leasing_agent < senior_manager < regional_manager < asset_manager < system_admin,
plus applicant/tenant), `property_ids` (staff scope array), `is_active`,
`email_verified_at`, `last_login`, `demo_run_id`.

## API surface

| Route | Permission |
|---|---|
| `GET /api/users` (+ `/:userId`, `/signup-stats`) | `user:view` (senior+) |
| `POST /api/users` | `user:manage` (system_admin) |
| `PATCH /api/users/:userId/activate` / `/deactivate` | `user:manage` |
| `POST /api/users/:userId/reset-password` | `user:manage` |
| `POST /api/users/me/password-reset-email` | authenticated applicant/tenant only |

## Compliance anchors

Role changes + logins audit-logged (`user_login/logout`, `permission_change`).

## Flags & env

`RESEND_API_KEY` / `RESEND_FROM` (reset emails).

## Current state

**Live.** Staff accounts for Global (Tee, Nancy, Dora, managers) are a go-live task —
hold-resolvers need roles carrying `screening:initiate`.

## Key files

`src/modules/users/{routes,service}.ts`, `src/modules/auth/magic-link-service.ts`.
