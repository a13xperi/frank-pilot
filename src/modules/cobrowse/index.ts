export { default as cobrowseRoutes } from "./routes";
export {
  startCobrowseHandler,
  registerCobrowseHandlers,
  __resetRegistrationForTests,
} from "./start-cobrowse";
export { confirmCobrowseHandler } from "./confirm-cobrowse";
export {
  buildFieldPlan,
  type FieldPlanStep,
  type CobrowsePrefill,
} from "./runtime/field-plan";
export {
  CobrowseOrchestrator,
  type CobrowseOrchestratorOptions,
  type FieldVerification,
} from "./runtime/orchestrator";
export {
  recordGuidedStep,
  cobrowseStatusHandler,
  guidedEnabled,
  type RecordStepResult,
} from "./guided";
export {
  coachingFor,
  nextStepKey,
  isGuidedStep,
  composeGuidedStatus,
  GUIDED_STEP_ORDER,
  type GuidedStepKey,
  type CoachingScript,
  type GuidedStatus,
} from "./runtime/coaching";
