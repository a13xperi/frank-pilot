export {
  isCareLineEvent,
  handleCareLinePostCall,
  captureIncident,
  type CaptureInput,
  type CaptureResult,
  type Channel,
} from "./service";
export {
  TAXONOMY,
  CATEGORIES,
  SEVERITIES,
  resolveSeverity,
  routingFor,
  coerceCategory,
  isCategory,
  isSeverity,
  type Category,
  type Severity,
  type RoutingIntent,
  type CategorySpec,
} from "./taxonomy";
export { evaluateEscalation, type EscalationDecision, type EscalationInput } from "./escalation";
export { isWithinCareCallWindow, localHour } from "./dialer";
