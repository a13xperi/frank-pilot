/**
 * Per-building outbound waitlist campaign config.
 *
 * A "campaign" is a building's waitlist worked by the outbound agent. The call
 * SCRIPT is the same for every building (re-engage → a unit is available → take
 * the application → text the apply link); only the building name and the
 * availability framing differ. Those differences are injected into the agent as
 * dynamic variables (see buildDynamicVariables in dialer.ts), so adding a
 * building is a config entry here, not a new agent or prompt.
 *
 * Donna Louise 2 is the first/special case: brand-new construction, move-in in
 * ~2 weeks. Existing buildings use the generic "a unit just opened" framing.
 */
export interface CampaignConfig {
  /** Drives the {{availability_note}} dynamic variable in the call script. */
  availabilityNote: string;
  /** Optional {{unit_types_available}} hint (e.g. "one and two bedroom"). */
  unitTypesAvailable?: string;
}

const CAMPAIGNS: Record<string, CampaignConfig> = {
  "donna-louise-2": {
    availabilityNote:
      "These are brand-new apartments, ready to move into in about two weeks.",
    unitTypesAvailable: "one and two bedroom",
  },
};

/** Fallback framing for any building without a specific campaign entry. */
export const DEFAULT_CAMPAIGN: CampaignConfig = {
  availabilityNote: "A unit has opened up.",
};

/**
 * Resolve the campaign framing for an applicant's building(s). The first
 * configured property among the applicant's list wins; otherwise the generic
 * framing. (Most applicants are on a single building; multi-list applicants
 * take the first configured match.)
 */
export function campaignFor(properties: string[]): CampaignConfig {
  for (const p of properties) {
    if (CAMPAIGNS[p]) return CAMPAIGNS[p];
  }
  return DEFAULT_CAMPAIGN;
}
