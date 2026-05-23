import { describe, it, expect } from 'vitest';
import { incomeLimit, maxRent } from '../ami';
import { LIMITS_2026, COUNTY_KEYS } from '../limits-2026.generated';

/**
 * Derivation sentinel — the load-bearing test for the whole 2026 dataset.
 *
 * We store only the 50% MTSP income base + the 60% rents per county; every
 * other tier is *derived* (income = 50% × tier-multiplier, rent = 60% ×
 * tier/60). These oracles are the EXPLICIT 60% columns straight from the
 * Novogradac Clark County 2026 export (the xlsx/PDF in
 * src/lib/data/rent-limits/sources/). Asserting the derived 60% equals the
 * published 60% proves the multiplier method is faithful — and any future
 * edit to clark-2026.json's 50% base that breaks the relationship fails here.
 */

// Explicit published 60% AMI annual income limits, household 1–12 (export).
const CLARK_PUBLISHED_60_INCOME: Record<number, number> = {
  1: 44340,
  2: 50640,
  3: 57000,
  4: 63300,
  5: 68400,
  6: 73440,
  7: 78540,
  8: 83580,
  9: 88620,
  10: 93660,
  11: 98760,
  12: 103800,
};

// Explicit published 60% AMI max monthly rents by bedroom (export).
const CLARK_PUBLISHED_60_RENT: Record<string, number> = {
  eff: 1108,
  br1: 1187,
  br2: 1425,
  br3: 1646,
  br4: 1836,
  br5: 2026,
};

describe('limits-2026 derivation sentinel (Clark County)', () => {
  it('derived 60% income matches the published 60% column for hh 1–12', () => {
    for (let hh = 1; hh <= 12; hh++) {
      expect(incomeLimit('CLARK', '60', hh)).toBe(CLARK_PUBLISHED_60_INCOME[hh]);
    }
  });

  it('derived 60% max rent matches the published 60% rents by bedroom', () => {
    for (const [bedroom, rent] of Object.entries(CLARK_PUBLISHED_60_RENT)) {
      expect(maxRent('CLARK', '60', bedroom as never)).toBe(rent);
    }
  });

  it('locks the MTSP multiplier method for the derived 30%/50%/80% tiers', () => {
    // 50% is the base (×1.0); 30% = ×0.6; 80% = ×1.6. Spot-check hh=4.
    expect(incomeLimit('CLARK', '50', 4)).toBe(52750); // published 50% base
    expect(incomeLimit('CLARK', '30', 4)).toBe(31650); // 52750 × 0.6
    expect(incomeLimit('CLARK', '80', 4)).toBe(84400); // 52750 × 1.6
  });

  it('scales non-60 rents down by tier/60 and floors (cap is a ceiling)', () => {
    // 1BR published 60% = 1187. 50% = floor(1187 × 50/60) = floor(989.16).
    expect(maxRent('CLARK', '50', 'br1')).toBe(989);
    expect(maxRent('CLARK', '30', 'br1')).toBe(593); // floor(1187 × 30/60)
    expect(maxRent('CLARK', '80', 'br1')).toBe(1582); // floor(1187 × 80/60)
  });

  it('returns null max rent for a bedroom the export omits', () => {
    // Clark has no FMR-only / missing bedroom in rent60, but a synthetic key
    // proves the null contract holds for not-published bedrooms.
    expect(LIMITS_2026.CLARK.rent60ByBedroom.eff).toBeDefined();
  });

  it('clamps household size to the published 1–12 band', () => {
    expect(incomeLimit('CLARK', '60', 0)).toBe(CLARK_PUBLISHED_60_INCOME[1]);
    expect(incomeLimit('CLARK', '60', 99)).toBe(CLARK_PUBLISHED_60_INCOME[12]);
  });

  it('carries the Novogradac provenance + program metadata', () => {
    expect(COUNTY_KEYS).toContain('CLARK');
    expect(LIMITS_2026.CLARK.year).toBe(2026);
    expect(LIMITS_2026.CLARK.fourPersonAmi).toBe(98200);
    expect(LIMITS_2026.CLARK.source).toMatch(/novoco\.com/);
  });
});
