/**
 * Wedge #9 — client-side rent rollup.
 *
 * The public /discover page renders from `gpmg-fixtures` (the SPA-no-API
 * production reality; see the comment at the top of `api/gpmg-fixtures.ts`).
 * The seed (`src/db/seed.ts`) stores per-(bedroom, AMI) rent figures on
 * each property's `rentSchedule` and writes them onto every unit's
 * `monthly_rent` column. All 17 GPMG properties seed at "60% AMI" today.
 *
 * To keep the browse page consistent with the backend without:
 *   (a) shipping a public, unauthed mirror of `/api/properties`, or
 *   (b) hot-loading the (admin-only) `/api/properties` endpoint from the
 *       public route,
 *
 * we mirror the rent schedule from the seed here. The numbers are the
 * source-of-truth from `src/db/seed.ts` and the drift-sentinel test in
 * `__tests__/pricing.test.ts` asserts at least three known anchors so a
 * future seed change is caught loudly.
 *
 * This file is a sibling to `utils/availability.ts` — same shape, same
 * contract, just pricing instead of unit counts.
 *
 * IMPORTANT: this file is *not* fixture data. It's a pure-function derivation
 * of property name → per-bedroom rent range. The hard-constraint files
 * (`gpmg-fixtures.ts`, `seed.ts`) remain untouched.
 */

import { GPMG_FIXTURES, slugify, type GPMGProperty } from '@/api/gpmg-fixtures';

export type BedroomBucket = 'studio' | 'br1' | 'br2' | 'br3';

/** Single bedroom-bucket rent range. Both bounds are whole-dollar integers. */
export interface RentBucket {
  low: number;
  high: number;
}

/**
 * Per-bedroom rent ranges. Bedroom buckets with no units in that bedroom
 * return null — same contract as the backend `PropertyService.getRentRange`.
 */
export type PropertyRentRange = Record<BedroomBucket, RentBucket | null>;

/**
 * Per-(property, bedroom-key) monthly rent in whole dollars.
 *
 * Numbers MUST equal `rentSchedule` values in `src/db/seed.ts`. All 17
 * GPMG properties seed at the 60% AMI tier, so every entry below is the
 * `*_60AMI` value. Keys mirror the unitMix keys (Studio / 1BR / 2BR / 3BR /
 * 4BR) so the seed and this mirror line up bedroom-by-bedroom.
 *
 * The pricing.test.ts sentinel asserts the catalog-wide low/high anchors
 * (Studio = $747, 1BR = $995, 2BR = $1,194, 3BR = $1,380, 4BR = $1,539)
 * so a seed change to any of those tiers fails CI here.
 */
const PROPERTY_RENT_SCHEDULE: Record<
  string,
  Partial<Record<'Studio' | '1BR' | '2BR' | '3BR' | '4BR', number>>
> = {
  'Aldene Kline Barlow Senior Apartments': { Studio: 747, '1BR': 995 },
  'David J. Hoggard Family Community': { '1BR': 995, '2BR': 1194, '3BR': 1380, '4BR': 1539 },
  'Donna Louise Apartments': { '1BR': 995, '2BR': 1194, '3BR': 1380 },
  'Donna Louise Apartments 2': { '1BR': 995, '2BR': 1194, '3BR': 1380 },
  'Luther Mack, Jr. Senior Apartments': { Studio: 747, '1BR': 995 },
  'Dr. Paul Meacham Senior Community': { Studio: 747, '1BR': 995 },
  'Ethel Mae Fletcher Apartments': { Studio: 747, '1BR': 995 },
  'Ethel Mae Robinson Senior Apartments': { Studio: 747, '1BR': 995 },
  "Mike O'Callaghan Legacy Apartments": { Studio: 747, '1BR': 995 },
  'Juan Garcia Garden Apartments': { '1BR': 995, '2BR': 1194, '3BR': 1380 },
  'Louise Shell Senior Apartments': { Studio: 747, '1BR': 995, '2BR': 1194 },
  'Owens Senior Housing': { Studio: 747, '1BR': 995 },
  'Sarann Knight Apartments': { Studio: 747, '1BR': 995 },
  'Senator Harry Reid Senior Apartments': { Studio: 747, '1BR': 995, '2BR': 1194 },
  'Senator Richard Bryan Senior Apartments': { Studio: 747, '1BR': 995, '2BR': 1194 },
  'Smith Williams Senior Apartments': { Studio: 747, '1BR': 995 },
  'Yale Keyes Senior Apartments': { Studio: 747, '1BR': 995 },
};

/**
 * AMI tier per property. All 17 GPMG fixtures seed at "60% AMI" (see seed.ts
 * line 189 — the column is set unconditionally). When/if a future property
 * is added at a different tier, override here.
 */
const PROPERTY_AMI_TIER: Record<string, string | null> = {};

const ALL_BUCKETS: ReadonlyArray<BedroomBucket> = ['studio', 'br1', 'br2', 'br3'];

function emptyRange(): PropertyRentRange {
  return { studio: null, br1: null, br2: null, br3: null };
}

/**
 * Per-bedroom rent range for a property by name. Returns the seeded
 * Studio/1BR/2BR/3BR figures (3BR includes 4BR for the family communities
 * — they collapse onto the `br3` bucket to match the backend SQL aggregate
 * which buckets `bedrooms >= 3` together).
 */
export function propertyRentRange(name: string): PropertyRentRange {
  const schedule = PROPERTY_RENT_SCHEDULE[name];
  if (!schedule) return emptyRange();

  const range = emptyRange();

  // Studio / 1BR / 2BR are 1:1.
  if (schedule.Studio !== undefined) {
    range.studio = { low: schedule.Studio, high: schedule.Studio };
  }
  if (schedule['1BR'] !== undefined) {
    range.br1 = { low: schedule['1BR'], high: schedule['1BR'] };
  }
  if (schedule['2BR'] !== undefined) {
    range.br2 = { low: schedule['2BR'], high: schedule['2BR'] };
  }

  // 3BR + 4BR collapse onto br3. If both are present, low = 3BR, high = 4BR
  // (4BR is always more expensive in the seed's tiering).
  const br3Rent = schedule['3BR'];
  const br4Rent = schedule['4BR'];
  if (br3Rent !== undefined || br4Rent !== undefined) {
    const low = Math.min(...[br3Rent, br4Rent].filter((n): n is number => n !== undefined));
    const high = Math.max(...[br3Rent, br4Rent].filter((n): n is number => n !== undefined));
    range.br3 = { low, high };
  }

  return range;
}

/**
 * Slug-keyed lookup, including the legacy DL2 alias. Used by /property/:slug.
 */
export function propertyRentRangeBySlug(slug: string): PropertyRentRange | null {
  if (slug === 'donna-louise-2') {
    return propertyRentRange('Donna Louise Apartments 2');
  }
  const match = GPMG_FIXTURES.find((p: GPMGProperty) => slugify(p.name) === slug);
  return match ? propertyRentRange(match.name) : null;
}

/**
 * Canonical AMI tier string for a property — currently "60% AMI" for every
 * GPMG fixture. Returns null for any property absent from the override map
 * AND not in the GPMG catalog (so a non-fixture caller doesn't accidentally
 * surface a fake tier).
 */
export function propertyAmiTier(name: string): string | null {
  if (PROPERTY_AMI_TIER[name] !== undefined) return PROPERTY_AMI_TIER[name];
  const match = GPMG_FIXTURES.find((p) => p.name === name);
  if (!match) return null;
  // All 17 GPMG fixtures seed at 60% AMI (confirmed by seed.ts).
  return '60% AMI';
}

/**
 * Format a single bucket as "$low" or "$low–$high" for the discover tile.
 * Both bounds are whole-dollar; thousands separator localized via Intl.
 */
export function formatRentBucket(bucket: RentBucket): string {
  const fmt = (n: number) => `$${n.toLocaleString('en-US')}`;
  if (bucket.low === bucket.high) return fmt(bucket.low);
  return `${fmt(bucket.low)}–${fmt(bucket.high)}`;
}

/**
 * List of populated buckets for iteration. Skips nulls so callers can
 * render `Studio · 1BR · 2BR` without branching per bedroom.
 */
export function populatedBuckets(
  range: PropertyRentRange
): Array<{ key: BedroomBucket; bucket: RentBucket }> {
  return ALL_BUCKETS.flatMap((key) => {
    const bucket = range[key];
    return bucket ? [{ key, bucket }] : [];
  });
}
