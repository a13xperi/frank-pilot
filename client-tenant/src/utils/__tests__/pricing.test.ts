// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  propertyRentRange,
  propertyRentRangeBySlug,
  propertyAmiTier,
  formatRentBucket,
  populatedBuckets,
} from '../pricing';
import { GPMG_FIXTURES, slugify } from '@/api/gpmg-fixtures';

// Drift sentinel for wedge #9 — these anchors come straight from
// `src/db/seed.ts:rentSchedule`. If the seed retunes a tier, one of the
// assertions below must move with it (or the test fails loudly).

describe('rent range (deterministic mirror of seed.ts:rentSchedule)', () => {
  it('Hoggard yields 1BR + 2BR + 3BR (3BR collapses 3BR+4BR; family community)', () => {
    const r = propertyRentRange('David J. Hoggard Family Community');
    // Anchors: 1BR=$995, 2BR=$1,194, 3BR=$1,380, 4BR=$1,539 (collapse → low=$1,380, high=$1,539).
    expect(r.studio).toBeNull();
    expect(r.br1).toEqual({ low: 995, high: 995 });
    expect(r.br2).toEqual({ low: 1194, high: 1194 });
    expect(r.br3).toEqual({ low: 1380, high: 1539 });
  });

  it('Senior-only property yields Studio + 1BR and null for higher buckets', () => {
    const r = propertyRentRange('Aldene Kline Barlow Senior Apartments');
    // Anchors: Studio=$747, 1BR=$995.
    expect(r.studio).toEqual({ low: 747, high: 747 });
    expect(r.br1).toEqual({ low: 995, high: 995 });
    expect(r.br2).toBeNull();
    expect(r.br3).toBeNull();
  });

  it('catalog-wide anchors: Studio=$747, 1BR=$995, 2BR=$1,194, 3BR=$1,380, 4BR=$1,539', () => {
    // These five anchors are the entire GPMG 60% AMI tier — every property
    // in the seed uses these exact values per bedroom. Any drift means the
    // mirror is out of sync and tile pricing would lie.
    expect(propertyRentRange('Smith Williams Senior Apartments').studio).toEqual({
      low: 747,
      high: 747,
    });
    expect(propertyRentRange('Yale Keyes Senior Apartments').br1).toEqual({
      low: 995,
      high: 995,
    });
    expect(propertyRentRange('Louise Shell Senior Apartments').br2).toEqual({
      low: 1194,
      high: 1194,
    });
    expect(propertyRentRange('Donna Louise Apartments').br3).toEqual({
      low: 1380,
      high: 1380,
    });
    // Hoggard is the only fixture with 4BR units — those collapse onto br3
    // with high=$1,539.
    expect(propertyRentRange('David J. Hoggard Family Community').br3?.high).toBe(1539);
  });

  it('slug lookup matches name lookup (and DL2 legacy alias works)', () => {
    for (const p of GPMG_FIXTURES) {
      const bySlug = propertyRentRangeBySlug(slugify(p.name));
      const byName = propertyRentRange(p.name);
      expect(bySlug).toEqual(byName);
    }
    const dl2 = propertyRentRangeBySlug('donna-louise-2');
    expect(dl2).toEqual(propertyRentRange('Donna Louise Apartments 2'));
  });

  it('every GPMG fixture has at least one populated bedroom bucket', () => {
    for (const p of GPMG_FIXTURES) {
      const r = propertyRentRange(p.name);
      const buckets = populatedBuckets(r);
      expect(buckets.length).toBeGreaterThan(0);
    }
  });

  it('every GPMG fixture is marked at 60% AMI (seed.ts amiSetAside)', () => {
    for (const p of GPMG_FIXTURES) {
      expect(propertyAmiTier(p.name)).toBe('60% AMI');
    }
  });

  it('non-GPMG property returns null AMI tier (no fake disclosure)', () => {
    expect(propertyAmiTier('Some Random Apartments')).toBeNull();
  });

  it('formatRentBucket renders single value as "$N" and ranges as "$low–$high" with commas', () => {
    expect(formatRentBucket({ low: 747, high: 747 })).toBe('$747');
    expect(formatRentBucket({ low: 1380, high: 1539 })).toBe('$1,380–$1,539');
  });

  it('populatedBuckets returns only buckets with units (skips nulls)', () => {
    const r = propertyRentRange('Aldene Kline Barlow Senior Apartments');
    const buckets = populatedBuckets(r);
    expect(buckets.map((b) => b.key)).toEqual(['studio', 'br1']);
  });
});
