# applicants

## Purpose

The public funnel entry: self-serve registration, property discovery, the intent quiz
(W0 AMI pre-qualifier), unit picker with soft claims, position-aware wait lists, and
applicant self-service on their own applications (submit, identity polling, lease
signing). The bridge from anonymous browser to authenticated applicant.

## Workflow encoded

1. **Register** (public) — idempotent magic-link issuance; **no user enumeration**
   (constant ≥250ms response floor closes the timing side-channel); Turnstile-verified;
   demo runs tagged via `x-demo-run` + `DEMO_LINK_SECRET`.
2. **Verify** — magic link consumed → `email_verified_at` set → JWT. The
   `requireEmailVerified` middleware gates everything state-changing after this.
3. **Intent quiz** — bedrooms/budget/move-in/household/income → draft application with
   W0 AMI tier; stamps `WAITING_LIST_APP_CAPTURED`.
4. **Unit picker** — ≤12 matching units, lazy-expires stale 48-hour holds, filters by
   AMI eligibility.
5. **Claim** — atomic unit hold (`held`, 48h expiry) under a per-user advisory lock;
   releases any prior claim; stamps `POSITION_LETTER_SENT`.
6. **Apply → submit-draft** — fills the draft; submit may return
   `consumerReportConsentRequired` (400 + disclosure text) until FCRA consent is fresh.
7. **Wait list** — join/leave/summary per (property, bedroom_count); position derived
   from `created_at` ordering; movement tracked via last-notified snapshots;
   unauthenticated callers see queue depth only.
8. **Lease signing** — see [lease](lease.md); served here on the `/applicants/me/*` surface.

## Data model

`users` (shared; `email_verified_at` is the gate column; `demo_run_id` for purges) ·
`user_applications` (ownership join, UNIQUE (user_id, application_id)) ·
`magic_link_tokens` (SHA-256 hash, TTL, single-use) · `units` (status
`available`/`held`/`leased`, `claim_expires_at`, per-unit `ami_designation`) ·
`waitlist_entries` (UNIQUE (property, bedroom_count, user); lane index for position
ranking) · `guest_sessions` + `saved_properties` (see [saved](saved.md)).

## API surface

Public: `POST /applicants/register` (rate-limited 5/min/email, 30/min/IP) ·
`GET /applicants/properties` (+ `/map`) ·
`GET /applicants/properties/:slug/waitlist-summary`.

Authenticated + email-verified (rate limits in parentheses):
`POST /applicants/intent` (20/min) · `GET /applicants/units` (60/min) ·
`POST /applicants/claim-unit/:id` / `DELETE /applicants/claim-unit` (20/min) ·
`POST /applicants/apply` · `POST /applicants/me/applications/submit-draft` ·
`GET /applicants/me/applications` (+ `/consumer-report-disclosure`,
`/identity-status`) · `POST .../waitlist-join` / `DELETE .../waitlist-leave` ·
`GET /applicants/me/lease` · `POST /applicants/me/lease/sign`.

## Compliance anchors

Stamps: `WAITING_LIST_APP_CAPTURED`, `POSITION_LETTER_SENT`,
`HUD_92006_SUPPLEMENT_CAPTURED`. FCRA disclosure surfaced before submit.
TCPA: `consent_outbound_ai_calls` captured here. Timing-side-channel defense and
no-enumeration on register.

## Flags & env

`TURNSTILE_SECRET_KEY` (prod-required CAPTCHA) · `DEMO_LINK_SECRET` (dev-link echo) ·
`REGISTER_RESPONSE_FLOOR_MS` (default 250) · `JWT_SECRET`.

## Current state

**Live** end to end. Gaps: guest→user shortlist conversion incomplete; Turnstile not
enforced in all envs; demo purge script unexercised at scale.

## Key files

`src/modules/applicants/routes.ts` (~1,470 lines — the funnel surface),
`src/modules/saved/{routes,service}.ts`.
