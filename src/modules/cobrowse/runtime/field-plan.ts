/**
 * Concierge co-browse — PURE field-plan builder.
 *
 * Given whatever prefill we already captured in-call (the data_collection from
 * the ElevenLabs intake, threaded through on the conversation), produce the
 * ordered list of wizard steps the (stubbed) computer-use orchestrator would
 * walk to fill out the tenant /apply wizard.
 *
 * This module is PURE: no DB, no logger, no side effects, no browser. It maps
 * a flat prefill object to the DOM selectors on
 * client-tenant/src/pages/apply/steps/Step2Details.tsx (id="ssn", "dob",
 * "address", "city", "state", "zip", "employer", "income", "household",
 * "moveIn") plus the wizard-level fields. Keeping it pure means the field
 * ordering + required-ness is unit-testable without spinning up Playwright.
 *
 * The orchestrator NEVER fills a field whose value is absent from the prefill —
 * buildFieldPlan returns one entry per selector regardless, but the runtime
 * only drives steps whose `value` is non-null (and stops on a missing
 * `required` value to hand back to the human).
 */

export interface FieldPlanStep {
  /** Stable key for the wizard step / logging — NOT the DOM selector. */
  stepKey: string;
  /** CSS selector on the /apply wizard (mirrors Step2Details.tsx ids). */
  selector: string;
  /** Human-readable label for the consent screen + audit trail. */
  label: string;
  /** Prefill value, or null when we don't have it captured. */
  value: string | null;
  /** Whether the wizard blocks submission without this field. */
  required: boolean;
}

/**
 * Loose shape of the in-call prefill. Every field optional — we fill what we
 * have and leave the rest for the human to complete in the live view.
 */
export interface CobrowsePrefill {
  city?: string | null;
  annualIncome?: string | number | null;
  householdSize?: string | number | null;
  ssn?: string | null;
  dateOfBirth?: string | null;
  addressLine1?: string | null;
  state?: string | null;
  zip?: string | null;
  employerName?: string | null;
  moveInDate?: string | null;
  [k: string]: unknown;
}

/**
 * Ordered spec: [stepKey, selector, label, prefillKey, required]. The order is
 * the order the orchestrator drives the wizard in. `required` mirrors the
 * wizard's own submit-gating (ssn / dob are the hard blockers in
 * Step2Details.tsx's `submitDisabled`).
 */
const FIELD_SPEC: ReadonlyArray<{
  stepKey: string;
  selector: string;
  label: string;
  prefillKey: keyof CobrowsePrefill;
  required: boolean;
}> = [
  { stepKey: "ssn", selector: "#ssn", label: "Social Security Number", prefillKey: "ssn", required: true },
  { stepKey: "dob", selector: "#dob", label: "Date of Birth", prefillKey: "dateOfBirth", required: true },
  { stepKey: "address", selector: "#address", label: "Street Address", prefillKey: "addressLine1", required: false },
  { stepKey: "city", selector: "#city", label: "City", prefillKey: "city", required: false },
  { stepKey: "state", selector: "#state", label: "State", prefillKey: "state", required: false },
  { stepKey: "zip", selector: "#zip", label: "ZIP", prefillKey: "zip", required: false },
  { stepKey: "employer", selector: "#employer", label: "Employer", prefillKey: "employerName", required: false },
  { stepKey: "income", selector: "#income", label: "Annual Income", prefillKey: "annualIncome", required: false },
  { stepKey: "household", selector: "#household", label: "Household Size", prefillKey: "householdSize", required: true },
  { stepKey: "moveIn", selector: "#moveIn", label: "Requested Move-In Date", prefillKey: "moveInDate", required: false },
];

function normalizeValue(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? String(raw) : null;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return trimmed ? trimmed : null;
  }
  return null;
}

/**
 * Build the ordered field plan from a prefill object. Pure — same input always
 * yields the same output, no I/O.
 */
export function buildFieldPlan(prefill: CobrowsePrefill | null | undefined): FieldPlanStep[] {
  const safe: CobrowsePrefill = prefill ?? {};
  return FIELD_SPEC.map((spec) => ({
    stepKey: spec.stepKey,
    selector: spec.selector,
    label: spec.label,
    value: normalizeValue(safe[spec.prefillKey]),
    required: spec.required,
  }));
}
