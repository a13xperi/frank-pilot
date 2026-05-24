-- QA/demo bundle audit-action gap (surfaced by the first live operator-side
-- demo-session replay). The audit-gated proxy endpoints in src/modules/qa/routes.ts
-- write audit_log.action = 'qa_bundle_read' before streaming each artifact, but
-- that value was never added to the audit_action enum. Result: every artifact
-- fetch (/api/qa/bundles/:stem/{png,sidecar,replay} and
-- /api/qa/demo/:runId/file/:name) throws `invalid input value for enum
-- audit_action: "qa_bundle_read"`. writeAuditLog re-throws by design, so the
-- handler returns 500 and the operator viewer can never load a replay. The QA
-- proxy unit tests mock writeAuditLog, so the gap was invisible until a live read.
--
-- Companion code fix (same change): the two writeAuditLog calls passed a
-- non-UUID resourceId (the bundle stem / `demo/{runId}`) into the UUID-typed
-- audit_log.resource_id column, which also threw. Those now carry the
-- identifier in details (JSONB) and leave resource_id NULL.
--
-- ADD VALUE IF NOT EXISTS is idempotent (Postgres 12+) and runs in autocommit
-- (each ALTER TYPE ... ADD VALUE cannot run inside a transaction block).

ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'qa_bundle_read';
