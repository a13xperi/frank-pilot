import { describe, it, expect } from 'vitest';
import {
  representativeSqft,
  representativeAmenities,
  representativeNeighborhood,
} from '../propertyProfile';

describe('propertyProfile (representative pilot data)', () => {
  it('is deterministic per seed', () => {
    expect(representativeSqft('owens-senior-housing', 'br1')).toBe(
      representativeSqft('owens-senior-housing', 'br1'),
    );
    expect(representativeAmenities('owens-senior-housing', 'senior')).toEqual(
      representativeAmenities('owens-senior-housing', 'senior'),
    );
    expect(representativeNeighborhood('owens-senior-housing')).toEqual(
      representativeNeighborhood('owens-senior-housing'),
    );
  });

  it('sqft stays near the bedroom-type anchor', () => {
    // br2 anchor is 920; variance is bounded so it stays in a sane band.
    const s = representativeSqft('donna-louise-apartments', 'br2');
    expect(s).toBeGreaterThanOrEqual(840);
    expect(s).toBeLessThanOrEqual(1000);
    expect(s % 10).toBe(0); // rounded to nearest 10
  });

  it('always includes the four core amenities', () => {
    for (const slug of ['owens-senior-housing', 'david-j-hoggard-family-community']) {
      const a = representativeAmenities(slug, slug.includes('family') ? 'family' : 'senior');
      expect(a).toEqual(expect.arrayContaining(['laundry', 'manager', 'smokefree', 'transit']));
      // Core (4) + 4 extras, de-duped.
      expect(a.length).toBe(8);
    }
  });

  it('family communities can surface a playground; senior communities can surface an elevator', () => {
    // Type-appropriate pools differ — verify the pools are wired by checking a
    // sweep of slugs surfaces the type-only amenity at least once.
    const slugs = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const familyHasPlayground = slugs.some((s) =>
      representativeAmenities(s, 'family').includes('playground'),
    );
    const seniorHasElevator = slugs.some((s) =>
      representativeAmenities(s, 'senior').includes('elevator'),
    );
    expect(familyHasPlayground).toBe(true);
    expect(seniorHasElevator).toBe(true);
  });

  it('neighborhood scores land in a plausible band and pick 4 nearby places', () => {
    const n = representativeNeighborhood('owens-senior-housing');
    for (const score of [n.walk, n.transit, n.quiet]) {
      expect(score).toBeGreaterThanOrEqual(45);
      expect(score).toBeLessThanOrEqual(88);
    }
    expect(n.nearby).toHaveLength(4);
    for (const { miles } of n.nearby) {
      expect(miles).toBeGreaterThanOrEqual(0.1);
      expect(miles).toBeLessThanOrEqual(0.9);
    }
  });
});
