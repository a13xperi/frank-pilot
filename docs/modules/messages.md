# messages

## Purpose

Application-scoped messaging between staff and applicants/tenants — the durable,
auditable alternative to phone tag, with property-scope gates so staff can't read
threads outside their portfolio.

## Workflow encoded

Staff list/reply on an application's thread; read-tracking (`read_at`) marks
applicant messages consumed. Applicant/tenant send surfaces exist on the tenant
module; cross-application access is blocked by ownership (`user_applications`) and
property scope (`buildPropertyScope`).

## Data model

`application_messages`: `application_id` FK, `sender_user_id`, `sender_role`
(CHECK in staff/applicant/tenant), `body` (1–4000 chars, non-empty CHECK),
`created_at`, `read_at`. Indexes: (application, created_at), sender.

## API surface

| Route | Permission |
|---|---|
| `GET /api/applications/:id/messages` | `application:read` + property scope |
| `POST /api/applications/:id/messages` | `application:read` + property scope (20/min) |
| `POST /api/applications/:id/messages/:msgId/read` | `application:read` (60/min) |

## Compliance anchors

No tape stamps; covered by `audit_log`. Property-scope enforcement is the
load-bearing control.

## Flags & env

None.

## Current state

Staff side **live**. Gaps: applicant/tenant self-serve send routes partially wired
(tenant surface exists); no push notification (SMS/email) on new messages; no search.

## Key files

`src/modules/messages/{routes,service}.ts`.
