/**
 * AMI (Area Median Income) qualification — W0 pre-qualifier logic.
 *
 * Thin layer over the canonical 2026 dataset (`limits-2026.generated.ts`,
 * ingested from the Novogradac Rent & Income Limit Calculator). Every income
 * tier derives from the published 50% MTSP base by the standard LIHTC
 * multiplier (30% = ×0.6, 50% = ×1.0, 60% = ×1.2, 80% = ×1.6); rents scale
 * from the published 60% rent by tier/60.
 *
 * `qualifyAmiTier` returns the lowest LIHTC tier an applicant qualifies for —
 * the most restrictive cap they're at-or-under, which also implies they
 * qualify for every higher tier (a 50% applicant qualifies for 50/60/80%
 * units; not 30%). Coverage today: Clark County / Las Vegas MSA; the dataset
 * is keyed by county so adding more is a data drop, not a code change.
 *
 * Source: https://rent-income.novoco.com/free/calculator
 * Novogradac does not guarantee the accuracy of these limits.
 */
import {
  LIMITS_2026,
  type AmiTier,
  type BedroomKey,
  type CountyKey,
} from './limits-2026.generated';

export type { AmiTier, BedroomKey, CountyKey } from './limits-2026.generated';

/** MSA identifiers exposed to callers (back-compat with the 2024 stub). */
export type MsaKey = 'LAS_VEGAS_HENDERSON';

/** MSA → county join. Add rows here as more counties are ingested. */
const MSA_TO_COUNTY: Record<MsaKey, CountyKey> = {
  LAS_VEGAS_HENDERSON: 'CLARK',
};

/** Standard MTSP multiplier off the 50% income base, per tier. */
const TIER_MULTIPLIER: Record<AmiTier, number> = {
  '30': 0.6,
  '50': 1.0,
  '60': 1.2,
  '80': 1.6,
};

const TIER_ORDER: ReadonlyArray<AmiTier> = ['30', '50', '60', '80'];

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
 * 1..12. Verified against the export: the derived 60% column matches the
 * explicit 60% income column exactly (see limits-2026.test.ts).
 */
export function incomeLimit(
  county: CountyKey,
  tier: AmiTier,
  householdSize: number,
): number {
  const base =
    LIMITS_2026[county].mtsp50ByHousehold[clampHouseholdSize(householdSize)];
  return Math.round(base * TIER_MULTIPLIER[tier]);
}

/**
 * Official 2026 max monthly rent for a county/tier/bedroom, in whole dollars,
 * or null if the export carries no figure for that bedroom. The published 60%
 * rent is returned verbatim; other tiers scale by tier/60 and round DOWN — a
 * rent cap is a ceiling you can never charge above.
 */
export function maxRent(
  county: CountyKey,
  tier: AmiTier,
  bedroom: BedroomKey,
): number | null {
  const rent60 = LIMITS_2026[county].rent60ByBedroom[bedroom];
  if (rent60 == null) return null;
  if (tier === '60') return rent60;
  return Math.floor((rent60 * TIER_MULTIPLIER[tier]) / TIER_MULTIPLIER['60']);
}

// ── Back-compat surface (the 2024 stub shape, now derived from 2026) ─────────

interface TierCaps {
  '30': number;
  '50': number;
  '60': number;
  '80': number;
}

interface MsaTable {
  msa: string;
  year: number;
  limits: Record<number, TierCaps>;
}

function buildMsaTable(msa: MsaKey): MsaTable {
  const county = MSA_TO_COUNTY[msa];
  const src = LIMITS_2026[county];
  const limits: Record<number, TierCaps> = {};
  for (let hh = MIN_HH; hh <= MAX_HH; hh++) {
    limits[hh] = {
      '30': incomeLimit(county, '30', hh),
      '50': incomeLimit(county, '50', hh),
      '60': incomeLimit(county, '60', hh),
      '80': incomeLimit(county, '80', hh),
    };
  }
  return { msa: src.msa, year: src.year, limits };
}

/**
 * Per-MSA income caps by household size (1..12) and tier — a derived view of
 * `LIMITS_2026`, kept for back-compat with existing callers/tests. The numbers
 * are live (computed from the 2026 dataset), not the old 2024 stub.
 */
export const AMI_TABLES: Record<MsaKey, MsaTable> = {
  LAS_VEGAS_HENDERSON: buildMsaTable('LAS_VEGAS_HENDERSON'),
};

/**
 * Given an MSA, household size, and gross annual income, return the lowest AMI
 * tier the applicant qualifies for, or null if over-income for the highest
 * tier (80% AMI). Signature unchanged from the 2024 stub.
 */
export function qualifyAmiTier(
  msa: MsaKey,
  householdSize: number,
  grossAnnualIncome: number,
): AmiTier | null {
  if (!Number.isFinite(grossAnnualIncome) || grossAnnualIncome < 0) return null;

  const county = MSA_TO_COUNTY[msa];
  for (const tier of TIER_ORDER) {
    if (grossAnnualIncome <= incomeLimit(county, tier, householdSize)) {
      return tier;
    }
  }
  return null;
}

export function formatAmiTier(tier: AmiTier | null): string {
  if (!tier) return 'Over income for affordable tiers';
  return `${tier}% AMI`;
}

/**
 * Returns the tiers an applicant qualifies for (inclusive of the minimum tier
 * and all higher tiers). Useful for unit-list filtering.
 */
export function qualifyingTiers(minTier: AmiTier | null): AmiTier[] {
  if (!minTier) return [];
  const idx = TIER_ORDER.indexOf(minTier);
  return TIER_ORDER.slice(idx);
}
