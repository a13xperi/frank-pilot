/**
 * GENERATED FILE — do not edit by hand.
 * Regenerate with: npm run ingest:limits
 * Source: https://rent-income.novoco.com/free/calculator (Novogradac Rent &
 * Income Limit Calculator). Novogradac does not guarantee accuracy of these
 * limits. Raw per-county captures live in src/lib/data/rent-limits/.
 *
 * Counties: Clark County.
 */

export type AmiTier = '30' | '50' | '60' | '80';
export type BedroomKey = 'eff' | 'br1' | 'br2' | 'br3' | 'br4' | 'br5';

export interface CountyLimits {
  countyKey: string;
  county: string;
  msa: string;
  year: number;
  program: string;
  personsPerBedroom: number;
  fourPersonAmi: number;
  source: string;
  retrieved: string;
  /** 50% MTSP income base by household size (1..12). All AMI tiers derive from this. */
  mtsp50ByHousehold: Record<number, number>;
  section8: {
    extremelyLow: Record<number, number>;
    veryLow: Record<number, number>;
    low: Record<number, number>;
  };
  /** Official 60% max monthly rent by bedroom (verbatim from export). */
  rent60ByBedroom: Partial<Record<BedroomKey, number>>;
  /** Fair Market Rent by bedroom (for context vs. the affordable cap). */
  fmrByBedroom: Partial<Record<BedroomKey, number>>;
}

export type CountyKey = 'CLARK';

export const LIMITS_2026: Record<CountyKey, CountyLimits> = {
  CLARK: {
    countyKey: 'CLARK',
    county: "Clark County",
    msa: "Las Vegas-Henderson-North Las Vegas, NV MSA",
    year: 2026,
    program: "IRC Section 42 Low Income Housing Tax Credit (LIHTC)",
    personsPerBedroom: 1.5,
    fourPersonAmi: 98200,
    source: "https://rent-income.novoco.com/free/calculator",
    retrieved: "2026-05-23",
    // 50% MTSP income base by household size; every AMI tier derives from this.
    mtsp50ByHousehold: { 1: 36950, 2: 42200, 3: 47500, 4: 52750, 5: 57000, 6: 61200, 7: 65450, 8: 69650, 9: 73850, 10: 78050, 11: 82300, 12: 86500 },
    section8: {
      extremelyLow: { 1: 22200, 2: 25350, 3: 28500, 4: 33000, 5: 38680, 6: 44360, 7: 50040, 8: 55720 },
      veryLow: { 1: 36950, 2: 42200, 3: 47500, 4: 52750, 5: 57000, 6: 61200, 7: 65450, 8: 69650, 9: 73850, 10: 78070, 11: 82290, 12: 86510 },
      low: { 1: 59100, 2: 67550, 3: 76000, 4: 84400, 5: 91200, 6: 97950, 7: 104700, 8: 111450, 9: 118160, 10: 124912, 11: 131664, 12: 138416 },
    },
    // Official 60% max rent by bedroom (verbatim); other tiers scale by tier/60.
    rent60ByBedroom: { eff: 1108, br1: 1187, br2: 1425, br3: 1646, br4: 1836, br5: 2026 },
    fmrByBedroom: { eff: 1333, br1: 1478, br2: 1735, br3: 2413, br4: 2764 },
  },
};

export const COUNTY_KEYS: readonly CountyKey[] = ['CLARK'];
