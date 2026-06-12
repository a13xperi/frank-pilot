# lease

## Purpose

Approved application → executed lease → onboarded tenant. Lease document generation
(OneSite), native in-app e-signature with ESIGN/UETA consent and tamper-evidence, and
onboarding side effects (Loft tenant creation, recertification scheduling).

## Workflow encoded

1. **Generate** (senior+) — requires `income_verified = true` (LIHTC §42 third-party
   verification gate). Calls OneSite (stub today) → document + `onesite_lease_id`;
   status → `lease_generated`; SMS "lease ready".
2. **Sign** (applicant, via `/applicants/me/lease/sign`) — signature pad or typed
   name; **`consent: z.literal(true)`** (ESIGN/UETA affirmation is structurally
   required); inserts `lease_signatures` with `document_hash` (SHA-256 of the executed
   PDF), `signer_ip`, `consent_at`; stamps `LEASE_EXECUTED`; status → `lease_signed`.
3. **Onboard** (senior+) — Loft tenant creation (stub), OneSite sync, schedules the
   annual recertification (anniversary = lease start + 12 months); status →
   `onboarded`. The tenant lifecycle modules take over from here.

## Data model

`lease_signatures`: UNIQUE `application_id` (one signature per application),
`signer_name`, `signature_image` (data URL), `signed_document_url`, `document_hash`,
`signer_ip` INET, `consent_at`, `signed_at`. Plus lease columns on `applications`
(`income_verified(_by/_at)`, lease dates, `onesite_lease_id`, `loft_tenant_id`).

## API surface

| Route | Permission |
|---|---|
| `POST /api/lease/:applicationId/generate` | `lease:generate` |
| `POST /api/lease/:applicationId/onboard` | `lease:generate` |
| `GET /api/lease/:applicationId` | `application:read` |
| `GET /applicants/me/lease` · `POST /applicants/me/lease/sign` | applicant self-serve (email-verified) |

## Compliance anchors

`LEASE_EXECUTED` tape stamp (ESIGN/UETA) · LIHTC §42 income-verification gate before
generation · recertification auto-created at onboarding · audit actions
`lease_generated`, `lease_signed`, `tenant_onboarded`.

## Flags & env

`DEMO_LEASE_PDF_URL` (demo override while OneSite is stubbed) ·
`ONESITE_API_URL/KEY`, `LOFT_API_URL/KEY` (integration credentials — both stubs today).

## Current state

Generation, signature, and onboarding flows **live**; **OneSite and Loft are stubs**
— real lease documents need Global's OneSite API credentials (open external ask).
Post-onboarding lease modifications route through [decision-matrix](decision-matrix.md).

## Key files

`src/modules/lease/{routes,service}.ts`,
`src/modules/integrations/{onesite,loft}.ts`.
