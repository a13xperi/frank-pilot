-- Add identity-verification result columns to applications.
-- Wires IdentityVerificationService into runFullScreening as the first
-- pre-step (Persona primary, Stripe Identity fallback). Rejection
-- short-circuits the pipeline to screening_failed with an FCRA
-- adverse-action notice; review_required contributes to overall_screening_result
-- the same way the existing three checks do.
--
-- result   maps from IdentityVerificationResult.result:
--   "verified"        -> 'pass'
--   "rejected"        -> 'fail'
--   "review_required" -> 'review_required'
-- details  is the full IdentityVerificationResult shape (confidence,
--          idType, livenessScore, riskSignals, optional rawResponse).
-- The audit + adverse-action chain reuses the existing
-- 'screening_completed' and 'adverse_action_notice_sent' audit actions
-- (same pattern as the duplicate-SSN early-exit), so no enum change.

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS identity_verification_result        screening_result,
  ADD COLUMN IF NOT EXISTS identity_verification_details       JSONB,
  ADD COLUMN IF NOT EXISTS identity_verification_completed_at  TIMESTAMPTZ;
