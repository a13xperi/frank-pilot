// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  getPropertyAvailability,
  getPropertyAvailabilityBySlug,
  propertyMatchesAmiTier,
} from '../availability';
import { GPMG_FIXTURES, slugify } from '@/api/gpmg-fixtures';

// These tests act as the cross-package drift sentinel. If `src/db/seed.ts`
// changes either the per-property unit mix or the `unitStatus(i)` cycle, one
// of the assertions below will fail loudly so the rollup mirror in
// `utils/availability.ts` stays in sync with the backend SQL aggregate.

describe('availability rollup (deterministic mirror of seed.ts)', () => {
  it('Hoggard (family, mixed bedrooms) yields a non-empty rollup across all 4 bedroom buckets', () => {
    const a = getPropertyAvailability('David J. Hoggard Family Community');
    // 100 total units → ~72% available with the 0..9 unitStatus cycle.
    expect(a.totalUnits).toBe(100);
    expect(a.availableCount).toBeGreaterThan(60);
    expect(a.availableCount).toBeLessThan(80);
    // Mix: 20×1BR, 40×2BR, 30×3BR, 10×4BR. With (i % 10) < 7 = available,
    // every bedroom block of size ≥ 1 ends up with at least 1 available.
    expect(a.bedroomBreakdown.br1).toBeGreaterThan(0);
    expect(a.bedroomBreakdown.br2).toBeGreaterThan(0);
    // 3BR + 4BR collapse onto br3.
    expect(a.bedroomBreakdown.br3).toBeGreaterThan(0);
  });

  it('Senior-only property has zero in non-applicable bedroom buckets', () => {
    // Aldene Kline Barlow: Studio + 1BR only.
    const a = getPropertyAvailability('Aldene Kline Barlow Senior Apartments');
    expect(a.bedroomBreakdown.studio).toBeGreaterThan(0);
    expect(a.bedroomBreakdown.br1).toBeGreaterThan(0);
    expect(a.bedroomBreakdown.br2).toBe(0);
    expect(a.bedroomBreakdown.br3).toBe(0);
  });

  it('slug lookup matches name lookup (and DL2 legacy alias works)', () => {
    for (const p of GPMG_FIXTURES) {
      const bySlug = getPropertyAvailabilityBySlug(slugify(p.name));
      const byName = getPropertyAvailability(p.name);
      expect(bySlug).toEqual(byName);
    }
    // Legacy slug alias from the apply-wizard MVP.
    const dl2 = getPropertyAvailabilityBySlug('donna-louise-2');
    expect(dl2).toEqual(getPropertyAvailability('Donna Louise Apartments 2'));
  });

  it('catalog-wide totals stay within ±5pp of the seed.ts 70/20/10 target', () => {
    let available = 0;
    let leased = 0;
    let held = 0;
    let total = 0;
    for (const p of GPMG_FIXTURES) {
      const a = getPropertyAvailability(p.name);
      available += a.availableCount;
      leased += a.leasedCount;
      held += a.heldCount;
      total += a.totalUnits;
    }
    // Match the seed.ts post-seed assertion tolerance.
    expect(total).toBeGreaterThan(1000);
    const pctAvail = (available / total) * 100;
    const pctLeased = (leased / total) * 100;
    const pctHeld = (held / total) * 100;
    expect(Math.abs(pctAvail - 70)).toBeLessThanOrEqual(5);
    expect(Math.abs(pctLeased - 20)).toBeLessThanOrEqual(5);
    expect(Math.abs(pctHeld - 10)).toBeLessThanOrEqual(5);
  });

  it('AMI tier matching mirrors applicants/units (60% set-aside, 80% slice excludes)', () => {
    const sample = GPMG_FIXTURES[0]!;
    expect(propertyMatchesAmiTier(sample, '30')).toBe(true);
    expect(propertyMatchesAmiTier(sample, '50')).toBe(true);
    expect(propertyMatchesAmiTier(sample, '60')).toBe(true);
    expect(propertyMatchesAmiTier(sample, '80')).toBe(false);
  });
});
