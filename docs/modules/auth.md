# auth

## Purpose

Authentication: magic-link (passwordless) for applicants/tenants, password login for
staff, JWT lifecycle — hardened against the boring-but-real attacks (timing oracles,
stale-token privilege, user enumeration).

## Workflow encoded

1. **Magic-link request** (public) — Turnstile + rate limits (5/min per (ip,email),
   30/min per IP); 6-digit token, 15-min TTL, single use, SHA-256-hashed at rest.
2. **Verify** — consumes token, stamps `email_verified_at`, issues JWT, migrates any
   guest shortlist to the user.
3. **Authenticate middleware** — verifies the JWT **and re-fetches the user from the
   DB on every request** — deactivation, role changes, and verification status take
   effect immediately; the JWT's `emailVerified` claim is advisory only.
4. **Staff login** — bcrypt with **timing-oracle mitigation (CRIT-1)**: a dummy
   `bcrypt.compare` runs on *every* failure path (unknown user / inactive / null hash
   / wrong password) so all failures cost ~80ms alike.

## Data model

`users` (see [users](users.md)) · `magic_link_tokens` (`token_hash` UNIQUE,
`expires_at`, `used_at`).

## API surface

`POST /api/auth/magic-link/request` (public; `devLink` echoed only with
`DEMO_LINK_SECRET`) · `POST /api/auth/magic-link/verify` ·
`GET /api/auth/me` (fresh DB read every call).

## Compliance anchors

Email-verification gate before any PII/state-changing route; security-audit items
CRIT-1 (timing) and the JWT-claim-vs-DB rule are encoded here.

## Flags & env

`JWT_SECRET` (prod boot-guard refuses to start without it) · `JWT_EXPIRY` (8h) ·
`RESEND_*`, `TWILIO_*` (delivery) · `DEMO_LINK_SECRET` · `TURNSTILE_SECRET_KEY`.

## Current state

**Live and hardened.**

## Key files

`src/modules/auth/{routes,magic-link-service}.ts`, `src/middleware/auth.ts`.
