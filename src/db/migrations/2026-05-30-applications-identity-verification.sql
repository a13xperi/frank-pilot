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
-- The rejection path reuses the existing 'adverse_action_notice_sent'
-- audit action (FCRA § 1681m mirror of the duplicate-SSN early-exit),
-- but identity verification itself writes its own audit row so reviewers
-- can distinguish identity vs. the final pipeline summary
-- ('screening_completed'). The new enum value is added below, matching
-- the BP-08 audit-action enum precedent.

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS identity_verification_result        screening_result,
  ADD COLUMN IF NOT EXISTS identity_verification_details       JSONB,
  ADD COLUMN IF NOT EXISTS identity_verification_completed_at  TIMESTAMPTZ;

ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'identity_verification_completed';
