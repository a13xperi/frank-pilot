/**
 * AMI (Area Median Income) qualification — backend-pure port of the W0
 * pre-qualifier (the canonical client copy lives in
 * `client-tenant/src/lib/ami.ts` + `client-tenant/src/lib/limits-2026.generated.ts`).
 *
 * This module is the SERVER-side authority: `POST /api/applicants/qualify`
 * computes and enforces the tier here so a client can never self-assign a
 * cheaper set-aside. It carries its own copy of the canonical 2026 dataset
 * (Novogradac Rent & Income Limit Calculator, Clark County / Las Vegas MSA) so
 * the backend has zero dependency on the client package or its bundler.
 *
 * Every income tier derives from the published 50% MTSP base by the standard
 * LIHTC multiplier (30% = ×0.6, 50% = ×1.0, 60% = ×1.2, 80% = ×1.6); rents
 * scale from the published 60% rent by tier/60.
 *
 * `qualifyAmiTier` returns the lowest LIHTC tier an applicant qualifies for —
 * the most restrictive cap they're at-or-under, which also implies they
 * qualify for every higher tier (a 50% applicant qualifies for 50/60/80%
 * units; not 30%), or null if over-income for the highest tier (80% AMI).
 *
 * Source: https://rent-income.novoco.com/free/calculator
 * Novogradac does not guarantee the accuracy of these limits.
 *
 * IMPORTANT: keep the dataset and math in lock-step with the client copy. If
 * the HUD limits are re-ingested on the client (`npm run ingest:limits`),
 * mirror the new numbers here. The values below match
 * `limits-2026.generated.ts` retrieved 2026-05-23.
 */

export type AmiTier = "30" | "50" | "60" | "80";
export type BedroomKey = "eff" | "br1" | "br2" | "br3" | "br4" | "br5";
export type CountyKey = "CLARK";

/** MSA identifiers exposed to callers (mirrors the client surface). */
export type MsaKey = "LAS_VEGAS_HENDERSON";

export interface CountyLimits {
  countyKey: string;
  county: string;
  msa: string;
  year: number;
  program: string;
  /** 50% MTSP income base by household size (1..12). All AMI tiers derive from this. */
  mtsp50ByHousehold: Record<number, number>;
  /** Official 60% max monthly rent by bedroom (verbatim from export). */
  rent60ByBedroom: Partial<Record<BedroomKey, number>>;
}

/**
 * Canonical 2026 LIHTC dataset, keyed by county. Mirror of the client's
 * `LIMITS_2026` (only the fields the backend pre-qualifier needs). Adding a
 * county is a data drop, not a code change.
 */
export const LIMITS: Record<CountyKey, CountyLimits> = {
  CLARK: {
    countyKey: "CLARK",
    county: "Clark County",
    msa: "Las Vegas-Henderson-North Las Vegas, NV MSA",
    year: 2026,
    program: "IRC Section 42 Low Income Housing Tax Credit (LIHTC)",
    // 50% MTSP income base by household size; every AMI tier derives from this.
    mtsp50ByHousehold: {
      1: 36950,
      2: 42200,
      3: 47500,
      4: 52750,
      5: 57000,
      6: 61200,
      7: 65450,
      8: 69650,
      9: 73850,
      10: 78050,
      11: 82300,
      12: 86500,
    },
    // Official 60% max rent by bedroom (verbatim); other tiers scale by tier/60.
    rent60ByBedroom: { eff: 1108, br1: 1187, br2: 1425, br3: 1646, br4: 1836, br5: 2026 },
  },
};

export const COUNTY_KEYS: readonly CountyKey[] = ["CLARK"];

/** All bedroom keys, in display order. */
export const BEDROOM_KEYS: readonly BedroomKey[] = [
  "eff",
  "br1",
  "br2",
  "br3",
  "br4",
  "br5",
];

/** MSA → county join. Add rows here as more counties are ingested. */
const MSA_TO_COUNTY: Record<MsaKey, CountyKey> = {
  LAS_VEGAS_HENDERSON: "CLARK",
};

/** Standard MTSP multiplier off the 50% income base, per tier. */
const TIER_MULTIPLIER: Record<AmiTier, number> = {
  "30": 0.6,
  "50": 1.0,
  "60": 1.2,
  "80": 1.6,
};

/** Tiers from most- to least-restrictive — the order qualification walks. */
export const TIER_ORDER: readonly AmiTier[] = ["30", "50", "60", "80"];

const MIN_HH = 1;
const MAX_HH = 12;

function clampHouseholdSize(n: number): number {
  const floored = Math.floor(n);
  if (!Number.isFinite(floored) || floored < MIN_HH) return MIN_HH;
  if (floored > MAX_HH) return MAX_HH;
  return floored;
}

/**
 * Official 2026 income cap for a county/tier/household size, in whole dollars.
 * Derived from the published 50% MTSP base × tier multiplier. The 50% values
 * are already HUD-rounded, so the product is an integer — Math.round only
 * clears floating-point dust (52750 × 0.6 = 31649.999…). Household clamped to
 * 1..12.
 */
export function incomeLimit(
  county: CountyKey,
  tier: AmiTier,
  householdSize: number,
): number {
  const base = LIMITS[county].mtsp50ByHousehold[clampHouseholdSize(householdSize)];
  return Math.round(base * TIER_MULTIPLIER[tier]);
}

/**
 * Official 2026 max monthly rent for a county/tier/bedroom, in whole dollars,
 * or null if the dataset carries no figure for that bedroom. The published 60%
 * rent is returned verbatim; other tiers scale by tier/60 and round DOWN — a
 * rent cap is a ceiling you can never charge above.
 */
export function maxRent(
  county: CountyKey,
  tier: AmiTier,
  bedroom: BedroomKey,
): number | null {
  const rent60 = LIMITS[county].rent60ByBedroom[bedroom];
  if (rent60 == null) return null;
  if (tier === "60") return rent60;
  return Math.floor((rent60 * TIER_MULTIPLIER[tier]) / TIER_MULTIPLIER["60"]);
}

/**
 * Given an MSA, household size, and gross annual income, return the lowest AMI
 * tier the applicant qualifies for, or null if over-income for the highest
 * tier (80% AMI). Signature mirrors the client.
 */
export function qualifyAmiTier(
  msaKey: MsaKey,
  householdSize: number,
  grossAnnualIncome: number,
): AmiTier | null {
  if (!Number.isFinite(grossAnnualIncome) || grossAnnualIncome < 0) return null;

  const county = MSA_TO_COUNTY[msaKey];
  for (const tier of TIER_ORDER) {
    if (grossAnnualIncome <= incomeLimit(county, tier, householdSize)) {
      return tier;
    }
  }
  return null;
}

/** Resolve an MSA key to its county, or null if unknown. */
export function countyForMsa(msaKey: MsaKey): CountyKey | null {
  return MSA_TO_COUNTY[msaKey] ?? null;
}
