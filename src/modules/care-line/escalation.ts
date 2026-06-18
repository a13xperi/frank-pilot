/**
 * Care Line escalation rules (§10 of the SoT). Pure decision function — the
 * caller performs the I/O (on-call lookup, tape stamp, optional SMS).
 */

import type { Severity } from "./taxonomy";

export interface EscalationInput {
  severity: Severity;
  safetyFlag: boolean;
  selfHarmFlag: boolean;
  /** Recipient-local business hours (drives after-hours paging for P1). */
  isBusinessHours: boolean;
}

export interface EscalationDecision {
  escalate: boolean;
  reason?: string;
  /** Tell the caller to hang up and dial 911 (immediate danger). */
  tell911?: boolean;
  /** Surface the 988 crisis line + flag a human care follow-up. */
  refer988?: boolean;
  /** Page the human on-call now. */
  pageOnCall?: boolean;
}

export function evaluateEscalation(input: EscalationInput): EscalationDecision {
  // P0 always — life-safety. 911 + page on-call instantly.
  if (input.severity === "P0") {
    return { escalate: true, reason: "P0 life-safety", tell911: true, pageOnCall: true };
  }
  // Self-harm / mental-health crisis — 988 + human follow-up (don't counsel).
  if (input.selfHarmFlag) {
    return { escalate: true, reason: "self-harm / wellbeing crisis", refer988: true, pageOnCall: true };
  }
  // Active P1 safety/security or building-system failure.
  if (input.severity === "P1") {
    return {
      escalate: true,
      reason: input.isBusinessHours ? "P1 same-day" : "P1 after-hours",
      pageOnCall: !input.isBusinessHours,
    };
  }
  // Standard P2/P3 — capture + queue, no escalation.
  return { escalate: false };
}
