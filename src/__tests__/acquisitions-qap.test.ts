/**
 * Unit tests for the QAP reference constants and the city→geographic-account
 * resolver. Pure functions / data — no DB, no mocks.
 */
import { cityToGeographicAccount } from '../modules/acquisitions/geography';
import {
  GEOGRAPHIC_ACCOUNTS,
  SET_ASIDES,
  RENT_ELECTIONS,
  LOW_RENT_TARGETING,
  LOW_RENT_TARGETING_MAX_POINTS,
  LOW_INCOME_TARGETING,
  RESIDENT_SERVICES,
  RESIDENT_SERVICES_MAX_POINTS,
  MIN_ELIGIBILITY_PCT,
} from '../modules/acquisitions/qap-2026';

describe('cityToGeographicAccount', () => {
  it('maps Clark County cities to CLARK', () => {
    expect(cityToGeographicAccount('Las Vegas')).toBe('CLARK');
    expect(cityToGeographicAccount('North Las Vegas')).toBe('CLARK');
    expect(cityToGeographicAccount('Henderson')).toBe('CLARK');
  });

  it('maps Washoe County cities to WASHOE', () => {
    expect(cityToGeographicAccount('Reno')).toBe('WASHOE');
    expect(cityToGeographicAccount('Sparks')).toBe('WASHOE');
    expect(cityToGeographicAccount('Incline Village')).toBe('WASHOE');
  });

  it('falls through to OTHER (Balance of State) for the rest of Nevada', () => {
    expect(cityToGeographicAccount('Elko')).toBe('OTHER');
    expect(cityToGeographicAccount('Carson City')).toBe('OTHER');
    expect(cityToGeographicAccount('Pahrump')).toBe('OTHER');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(cityToGeographicAccount('  henderson ')).toBe('CLARK');
    expect(cityToGeographicAccount('RENO')).toBe('WASHOE');
  });

  it('treats null/blank city as OTHER (the residual account)', () => {
    expect(cityToGeographicAccount(null)).toBe('OTHER');
    expect(cityToGeographicAccount(undefined)).toBe('OTHER');
    expect(cityToGeographicAccount('   ')).toBe('OTHER');
  });
});

describe('QAP geographic accounts', () => {
  it('ceilings sum to 100% of the state credit allocation', () => {
    const sum = Object.values(GEOGRAPHIC_ACCOUNTS).reduce((s, a) => s + a.ceilingPct, 0);
    expect(sum).toBe(100);
  });

  it('Clark is the largest account', () => {
    expect(GEOGRAPHIC_ACCOUNTS.CLARK.ceilingPct).toBeGreaterThan(
      GEOGRAPHIC_ACCOUNTS.WASHOE.ceilingPct,
    );
    expect(GEOGRAPHIC_ACCOUNTS.WASHOE.ceilingPct).toBeGreaterThan(
      GEOGRAPHIC_ACCOUNTS.OTHER.ceilingPct,
    );
  });
});

describe('QAP scoring constants', () => {
  it('low-rent targeting is ordered deepest-first and tops out at the section max', () => {
    const first = LOW_RENT_TARGETING[0];
    expect(first.amiPct).toBe(30);
    expect(first.points).toBe(LOW_RENT_TARGETING_MAX_POINTS);
    const maxRow = LOW_RENT_TARGETING.reduce((m, r) => (r.points > m.points ? r : m));
    expect(maxRow.points).toBe(LOW_RENT_TARGETING_MAX_POINTS);
  });

  it('low-income targeting bonus only applies to the deep elections', () => {
    expect(LOW_INCOME_TARGETING.qualifyingElections).toContain('STD_20_50');
    expect(LOW_INCOME_TARGETING.qualifyingElections).toContain('AVERAGE_INCOME');
    expect(LOW_INCOME_TARGETING.qualifyingElections).not.toContain('STD_40_60');
  });

  it('resident-services menu cannot individually exceed the section cap', () => {
    for (const svc of Object.values(RESIDENT_SERVICES)) {
      expect(svc.points).toBeLessThanOrEqual(RESIDENT_SERVICES_MAX_POINTS);
    }
  });

  it('rent elections expose the correct minimum set-aside shares', () => {
    expect(RENT_ELECTIONS.STD_40_60.minSetAsidePct).toBe(40);
    expect(RENT_ELECTIONS.STD_20_50.minSetAsidePct).toBe(20);
    expect(RENT_ELECTIONS.STD_20_50.ceilingAmiPct).toBe(50);
  });

  it('nonprofit set-aside meets the federal 10% floor', () => {
    expect(SET_ASIDES.NONPROFIT.ceilingPct).toBeGreaterThanOrEqual(10);
  });

  it('eligibility floor is 60% of available points', () => {
    expect(MIN_ELIGIBILITY_PCT).toBe(60);
  });
});
