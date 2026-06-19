/**
 * Care Line incident taxonomy (§6 of the SoT). Pure logic — no I/O.
 *
 * Server is the severity authority: it starts from the category's base severity
 * and only ever escalates UP (honors the agent's self-assessed severity or a
 * safety/self-harm flag when they're MORE severe — never less). "When unsure,
 * escalate up, not down."
 */

export type Severity = "P0" | "P1" | "P2" | "P3";

export type Category =
  | "life_safety"
  | "safety_security"
  | "building_systems_down"
  | "unit_habitability"
  | "lease_violation"
  | "resident_wellbeing"
  | "move_in"
  | "general_info"
  | "anonymous_tip";

export type RoutingIntent =
  | "call_911_oncall"
  | "oncall_workorder"
  | "workorder"
  | "human_triage"
  | "crisis_988"
  | "log_only";

export interface CategorySpec {
  severity: Severity;
  routing: RoutingIntent;
}

/**
 * Note the deliberate routing choices:
 * - safety_security / lease_violation / anonymous_tip → human_triage, NOT an
 *   auto lease_violation. Reports ABOUT other residents (e.g. "drug use in the
 *   elevator") carry fair-housing risk; a human reviews before any enforcement.
 * - resident_wellbeing → crisis_988 (988 + human care follow-up), never counsel.
 */
export const TAXONOMY: Record<Category, CategorySpec> = {
  life_safety: { severity: "P0", routing: "call_911_oncall" },
  safety_security: { severity: "P1", routing: "human_triage" },
  building_systems_down: { severity: "P1", routing: "oncall_workorder" },
  unit_habitability: { severity: "P2", routing: "workorder" },
  lease_violation: { severity: "P2", routing: "human_triage" },
  resident_wellbeing: { severity: "P1", routing: "crisis_988" },
  move_in: { severity: "P3", routing: "log_only" },
  general_info: { severity: "P3", routing: "log_only" },
  anonymous_tip: { severity: "P2", routing: "human_triage" },
};

export const CATEGORIES = Object.keys(TAXONOMY) as Category[];
export const SEVERITIES: Severity[] = ["P0", "P1", "P2", "P3"];

const RANK: Record<Severity, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

export function isCategory(v: unknown): v is Category {
  return typeof v === "string" && v in TAXONOMY;
}
export function isSeverity(v: unknown): v is Severity {
  return v === "P0" || v === "P1" || v === "P2" || v === "P3";
}

/** Normalize a possibly-bad agent category to a known one (default escalate-up). */
export function coerceCategory(raw: unknown): Category {
  return isCategory(raw) ? raw : "anonymous_tip"; // unknown → treat as a tip, human-triaged
}

/**
 * Resolve final severity: base from category, escalated up by a more-severe
 * agent assessment, a safety flag, or a self-harm flag. Never downgraded.
 */
export function resolveSeverity(
  category: Category,
  agentSeverity: Severity | null,
  safetyFlag: boolean,
  selfHarmFlag: boolean
): Severity {
  let sev: Severity = TAXONOMY[category].severity;
  const up = (candidate: Severity) => {
    if (RANK[candidate] < RANK[sev]) sev = candidate;
  };
  if (agentSeverity) up(agentSeverity);
  if (safetyFlag) up("P1");
  if (selfHarmFlag) up("P1");
  return sev;
}

export function routingFor(category: Category): RoutingIntent {
  return TAXONOMY[category].routing;
}
