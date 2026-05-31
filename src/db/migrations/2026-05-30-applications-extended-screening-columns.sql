-- Phase 4a: add extended-screening result columns to applications.
-- Persists the three dormant adapters once they join runFullScreening behind
-- the SCREENING_EXTENDED_CHECKS_ENABLED dark flag (default OFF). Additive only —
-- no enum churn: every column reuses the existing screening_result enum, and the
-- extended verdicts ride in the status-transition evidence (status_history),
-- so no new audit_action value is required.
--
-- Mapping (service.ts, mirrors the identity/background pattern):
--   income_verification_result  ← Plaid Income: "verified" -> 'pass',
--                                   "unverified"/"review_required" -> 'review_required'
--   nsopw_result                ← Direct NSOPW: "no_match" -> 'pass',
--                                   "match" -> 'fail' (24 CFR §5.856 lifetime
--                                   mandatory denial), "review_required" -> 'review_required'
--   work_number_result          ← Work Number (only when a W-2 employer was
--                                   declared): "verified" -> 'pass', other -> 'review_required',
--                                   a thrown/keyless adapter -> 'could_not_screen' HOLD;
--                                   NULL when not run (no declared employer).
-- *_details  is the adapter's own details object (raw response, sources, etc.).
-- The income cross-check (Plaid vs Work Number / self-reported, >15% delta)
-- raises an existing income_mismatch fraud_flag — no schema change there.

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS income_verification_result        screening_result,
  ADD COLUMN IF NOT EXISTS income_verification_details       JSONB,
  ADD COLUMN IF NOT EXISTS income_verification_completed_at  TIMESTAMPTZ,

  ADD COLUMN IF NOT EXISTS work_number_result                screening_result,
  ADD COLUMN IF NOT EXISTS work_number_details               JSONB,
  ADD COLUMN IF NOT EXISTS work_number_completed_at          TIMESTAMPTZ,

  ADD COLUMN IF NOT EXISTS nsopw_result                      screening_result,
  ADD COLUMN IF NOT EXISTS nsopw_details                     JSONB,
  ADD COLUMN IF NOT EXISTS nsopw_completed_at                TIMESTAMPTZ;
