-- BP-08 audit-action enum gap (surfaced by the first real client→Stripe→ledger
-- smoke). intents.ts and webhook.ts write five new audit_log.action values for
-- the PaymentIntent lifecycle, but they were never added to the audit_action
-- enum. Result: every `payment_intent_*` audit write throws
-- `invalid input value for enum audit_action`. writeAuditLog re-throws by
-- design (audit failures must not silently pass), so on the unwrapped
-- replay/blocked paths in intents.ts that rejection is unhandled and crashes
-- the API process. The mocked payment unit tests never hit a real enum, so the
-- gap was invisible until a live transaction.
--
-- ADD VALUE IF NOT EXISTS is idempotent (Postgres 12+) and runs in autocommit
-- (each ALTER TYPE ... ADD VALUE cannot run inside a transaction block, and the
-- migration runner applies these statements without an explicit BEGIN/COMMIT).

ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'payment_intent_created';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'payment_intent_replay';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'payment_intent_replay_blocked';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'payment_intent_succeeded';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'payment_intent_failed';
