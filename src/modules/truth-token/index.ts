/**
 * Truth Token module — provable grounding attestation (Phase 3).
 *
 * Public surface: issueTruthToken (mint, called by grounded-answer paths like
 * housing-qa after finalizeAnswer) and truthTokenRoutes (the read-only verify
 * router mounted in src/index.ts behind TRUTH_TOKEN_ENABLED).
 */

export {
  issueTruthToken,
  verifyTruthToken,
} from "./service";
export type {
  IssueTruthTokenInput,
  IssueTruthTokenResult,
  TruthToken,
  VerifyTruthTokenResult,
} from "./service";
export { truthTokenRoutes } from "./routes";
