/**
 * Application requirements catalog — the canonical "what an applicant must
 * provide", plus how each item's status is DERIVED from the system-of-record
 * columns on `applications` when there's no explicit override row.
 *
 * This is the deterministic backbone of the follow-up loop's "what's still
 * missing": a callback can name the exact gap ("your two most recent pay
 * stubs") because the system KNOWS the gap, instead of relying on the LLM to
 * recall it from the free-form follow_ups.checkpoint.
 *
 * Each item is one of the discrete things Frank/PM collect on the golden path,
 * mapped to the real screening columns that already exist (no new upload infra):
 *   photo_id          — government photo ID  (Stripe Identity verdict / session)
 *   ssn_proof         — SSN on file          (ssn_encrypted present)
 *   income_paystubs   — proof of income      (income_verified / income verdict)
 *   consent_screening — background+credit ok  (screening_authorization_at)
 *
 * `label` is the voice-friendly phrase Frank says. `deriveStatus` is a pure
 * function of the coarse signals — never PII (no name/SSN/DOB), only the
 * categorical verdicts get_application_status already exposes.
 */

export type RequirementStatus = "missing" | "received" | "verified" | "waived";

/**
 * The coarse, non-PII application signals the catalog derives item status from.
 * Mirrors the columns get_application_status / buildContextPacket already read.
 */
export interface AppSignals {
  status: string | null;
  hasSsn: boolean;
  identityResult: string | null; // screening_result: pass|fail|review_required|could_not_screen
  identitySessionStatus: string | null; // free text: verified|processing|unverified|...
  incomeVerified: boolean;
  incomeResult: string | null; // screening_result
  screeningAuthorizedAt: string | Date | null;
}

export interface RequirementItem {
  key: string;
  /** Voice-friendly phrase Frank reads ("your two most recent pay stubs"). */
  label: string;
  required: boolean;
  /** Column-derived status when there's no explicit application_requirements row. */
  deriveStatus: (s: AppSignals) => RequirementStatus;
}

function truthyPresent(v: unknown): boolean {
  return v !== null && v !== undefined && String(v).trim() !== "";
}

export const REQUIREMENT_CATALOG: RequirementItem[] = [
  {
    key: "photo_id",
    label: "a government photo ID",
    required: true,
    deriveStatus: (s) => {
      if (s.identityResult === "pass") return "verified";
      const sess = (s.identitySessionStatus ?? "").toLowerCase();
      if (sess === "verified") return "verified";
      if (sess === "processing" || sess === "submitted") return "received";
      return "missing";
    },
  },
  {
    key: "ssn_proof",
    label: "your Social Security number",
    required: true,
    deriveStatus: (s) => (s.hasSsn ? "received" : "missing"),
  },
  {
    key: "income_paystubs",
    label: "your two most recent pay stubs",
    required: true,
    deriveStatus: (s) => {
      if (s.incomeVerified || s.incomeResult === "pass") return "verified";
      if (s.incomeResult === "review_required") return "received";
      return "missing";
    },
  },
  {
    key: "consent_screening",
    label: "your okay to run the background and credit check",
    required: true,
    deriveStatus: (s) => (truthyPresent(s.screeningAuthorizedAt) ? "received" : "missing"),
  },
];

export const CATALOG_BY_KEY: Map<string, RequirementItem> = new Map(
  REQUIREMENT_CATALOG.map((item) => [item.key, item])
);

/** An item is satisfied (not an open loop) when it's received, verified, or waived. */
export function isSatisfied(status: RequirementStatus): boolean {
  return status === "received" || status === "verified" || status === "waived";
}
