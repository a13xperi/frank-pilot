/**
 * AMI (Area Median Income) qualification — W0 pre-qualifier logic.
 *
 * Returns the lowest LIHTC tier an applicant qualifies for based on
 * household size + gross annual income against a per-MSA HUD income-cap
 * table. "Lowest tier" = most restrictive cap they're at-or-under, which
 * also implies they qualify for every higher tier (a 50% applicant qualifies
 * for 50/60/80% units; not 30%).
 *
 * Coverage v1: Las Vegas–Henderson–Paradise MSA (gpmglv parity target).
 *
 * Numbers below are stubs approximating HUD 2024 limits. Replace with HUD
 * 2026 published limits before production rollout.
 * Source: https://www.huduser.gov/portal/datasets/il.html
 */

export type AmiTier = '30' | '50' | '60' | '80';

interface TierCaps {
  '30': number;
  '50': number;
  '60': number;
  '80': number;
}

type HouseholdSizeKey = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

interface MsaTable {
  msa: string;
  year: number;
  limits: Record<HouseholdSizeKey, TierCaps>;
}

export const AMI_TABLES = {
  LAS_VEGAS_HENDERSON: {
    msa: 'Las Vegas-Henderson-Paradise, NV MSA',
    year: 2024,
    limits: {
      1: { '30': 18_150, '50': 30_250, '60': 36_300, '80': 48_400 },
      2: { '30': 20_750, '50': 34_550, '60': 41_460, '80': 55_300 },
      3: { '30': 23_350, '50': 38_850, '60': 46_620, '80': 62_200 },
      4: { '30': 25_900, '50': 43_200, '60': 51_840, '80': 69_100 },
      5: { '30': 28_000, '50': 46_700, '60': 56_040, '80': 74_650 },
      6: { '30': 30_100, '50': 50_150, '60': 60_180, '80': 80_200 },
      7: { '30': 32_150, '50': 53_600, '60': 64_320, '80': 85_700 },
      8: { '30': 34_250, '50': 57_050, '60': 68_460, '80': 91_250 },
    },
  },
} as const satisfies Record<string, MsaTable>;

export type MsaKey = keyof typeof AMI_TABLES;

const TIER_ORDER: ReadonlyArray<AmiTier> = ['30', '50', '60', '80'];

function clampHouseholdSize(n: number): HouseholdSizeKey {
  const floored = Math.floor(n);
  if (!Number.isFinite(floored) || floored < 1) return 1;
  if (floored > 8) return 8;
  return floored as HouseholdSizeKey;
}

/**
 * Given an MSA, household size, and gross annual income, return the lowest
 * AMI tier the applicant qualifies for, or null if over-income for the
 * highest tier (80% AMI).
 */
export function qualifyAmiTier(
  msa: MsaKey,
  householdSize: number,
  grossAnnualIncome: number,
): AmiTier | null {
  if (!Number.isFinite(grossAnnualIncome) || grossAnnualIncome < 0) return null;

  const table = AMI_TABLES[msa];
  const size = clampHouseholdSize(householdSize);
  const caps = table.limits[size];

  for (const tier of TIER_ORDER) {
    if (grossAnnualIncome <= caps[tier]) return tier;
  }
  return null;
}

export function formatAmiTier(tier: AmiTier | null): string {
  if (!tier) return 'Over income for affordable tiers';
  return `${tier}% AMI`;
}

/**
 * Returns the tiers an applicant qualifies for (inclusive of the minimum
 * tier and all higher tiers). Useful for unit-list filtering.
 */
export function qualifyingTiers(minTier: AmiTier | null): AmiTier[] {
  if (!minTier) return [];
  const idx = TIER_ORDER.indexOf(minTier);
  return TIER_ORDER.slice(idx);
}
