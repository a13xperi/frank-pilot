# saved

## Purpose

The saved-property shortlist with guest support: anonymous browsers can save
properties (httpOnly-cookie guest sessions) and convert to real accounts later; users
get named lists, vacancy-alert flags, and side-by-side comparison.

## Workflow encoded

1. **Guest save** — first write mints a `guest_sessions` row + `uh_guest` httpOnly
   SameSite=Lax cookie (~90d); only the SHA-256 of the token is stored.
2. **Save/unsave** — idempotent upsert/delete keyed on (owner, property, list_name).
3. **Conversion** — on magic-link account creation the guest's saves re-point to the
   user (`converted_user_id`).
4. **Alerts** — `alert_enabled` flag per save (delivery scheduler not yet built).
5. **Compare** — `GET /saved/compare?ids=…` resolves slugs/UUIDs side by side.

## Data model

`guest_sessions` (`token_hash` UNIQUE, `converted_user_id`, `demo_run_id`,
`last_seen_at`) · `saved_properties` with the **exactly-one-owner CHECK**
(`guest_session_id` XOR `user_id`) + partial unique indexes per owner.

## API surface

`POST /saved` · `DELETE /saved/:propertyId` · `GET /saved` ·
`PATCH /saved/:propertyId/alert` · `GET /saved/compare` — all public-or-authenticated
(owner resolved from cookie or JWT; no session minted on reads).

## Compliance anchors

Guest privacy: hash-only token storage, httpOnly cookie, no enumeration.
Demo data tagged by `demo_run_id` for purging.

## Flags & env

None (cookie `secure` in production).

## Current state

**Live.** Gaps: guest→user conversion logic incomplete; no alert delivery scheduler;
stale guest sessions never reaped; compare endpoint doesn't restrict to saved items.

## Key files

`src/modules/saved/{routes,service}.ts` (+ surfaces in `applicants/routes.ts`).
