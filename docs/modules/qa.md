# qa

## Purpose

Operator QA bundle viewer: lists and proxies debug screenshots + rrweb session
recordings from Supabase Storage (`frank-qa-screenshots` bucket on Sage), with an
audit entry written before any artifact byte is served.

## Workflow encoded

Tenant app captures upload PNG + JSON sidecar (+ optional rrweb replay) named
`frank-{slug}-{YYYYMMDD-HHMMSS}`; operators list bundles and stream artifacts through
a service-role proxy (works whether the bucket is public or locked down); demo runs
live under `demo/{runId}/`.

## Data model

None local — pure Supabase Storage. Path safety enforced by strict regexes on stem,
runId, and filename (no traversal).

## API surface

`GET /api/qa/bundles` (+ `/:stem`, `/:stem/{png|sidecar|replay}`) ·
`GET /api/qa/demo` (+ `/:runId`, `/:runId/file/:name`) — all `audit:view`;
every artifact fetch writes a `qa_bundle_read` audit entry first.

## Compliance anchors

Audit-before-bytes; service-role key never leaves the server.

## Flags & env

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (503 without).

## Current state

**Live.** Follow-up on record: privatize the bucket (legacy public URLs still work
during rollout; anon-key access dies at lockdown).

## Key files

`src/modules/qa/routes.ts`.
