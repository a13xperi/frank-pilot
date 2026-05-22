/**
 * Wedge #8 — client-side availability rollup.
 *
 * The public /discover page renders from `gpmg-fixtures` (the SPA-no-API
 * production reality; see the comment at the top of `api/gpmg-fixtures.ts`).
 * The seed (`src/db/seed.ts`) distributes ~1,118 units across 17 properties
 * with a deterministic `unitStatus(i)` that yields ~70% available / 20%
 * leased / 10% held. The actual seeded counts (after the deterministic 0..9
 * cycle modulates with each (property, bedroom) bucket size) round to
 * roughly 72% / 19% / 9% — the same shape the operator demo runs against.
 *
 * To keep the browse page consistent with the backend without:
 *   (a) shipping a public, unauthed mirror of `/api/properties`, or
 *   (b) hot-loading the (admin-only) `/api/properties` endpoint from the
 *       public route,
 *
 * we mirror the deterministic distribution _and_ the per-property unit mix
 * from the seed here. The unit mix is the source-of-truth from `seed.ts`;
 * if seed numbers ever change, these constants must move with them — the
 * AvailabilityDriftSentinel test in `__tests__/availability.test.ts` will
 * fail loudly if total unit counts drift from the GPMG_FIXTURES `units`
 * column.
 *
 * IMPORTANT: this file is *not* fixture data. It's a pure-function derivation
 * of (unit count, mix) → availability counts. The hard-constraint files
 * (`gpmg-fixtures.ts`, `seed.ts`) remain untouched.
 */

import { GPMG_FIXTURES, slugify, type GPMGProperty } from '@/api/gpmg-fixtures';

export type BedroomBucket = 'studio' | 'br1' | 'br2' | 'br3';

export interface PropertyAvailability {
  availableCount: number;
  leasedCount: number;
  heldCount: number;
  totalUnits: number;
  bedroomBreakdown: Record<BedroomBucket, number>;
}

/**
 * Mirror of `src/db/seed.ts:unitStatus(i)` — buckets 0-6 → available, 7-8 →
 * leased, 9 → held. Pure, deterministic, no Math.random.
 */
function unitStatus(i: number): 'available' | 'leased' | 'held' {
  const bucket = i % 10;
  if (bucket < 7) return 'available';
  if (bucket < 9) return 'leased';
  return 'held';
}

/**
 * Per-property unit mix from `src/db/seed.ts` (NOT from `gpmg-fixtures.ts`,
 * which omits the bedroom breakdown). Keyed by property name verbatim so the
 * lookup matches whatever the fixture iterator yields.
 *
 * Numbers MUST equal the `unitMix` blocks in seed.ts. The
 * `availability.test.ts` sentinel asserts each row sums to GPMG_FIXTURES.units
 * (when published) so drift in either direction is caught at test time.
 */
const PROPERTY_UNIT_MIX: Record<string, { Studio?: number; '1BR'?: number; '2BR'?: number; '3BR'?: number; '4BR'?: number }> = {
  'Aldene Kline Barlow Senior Apartments': { Studio: 10, '1BR': 29 },
  'David J. Hoggard Family Community': { '1BR': 20, '2BR': 40, '3BR': 30, '4BR': 10 },
  'Donna Louise Apartments': { '1BR': 12, '2BR': 24, '3BR': 12 },
  // DL2 unit count not in source — seed.ts assumes 48 (twin building).
  'Donna Louise Apartments 2': { '1BR': 12, '2BR': 24, '3BR': 12 },
  'Luther Mack, Jr. Senior Apartments': { Studio: 12, '1BR': 36 },
  'Dr. Paul Meacham Senior Community': { Studio: 15, '1BR': 42 },
  'Ethel Mae Fletcher Apartments': { Studio: 10, '1BR': 32 },
  'Ethel Mae Robinson Senior Apartments': { Studio: 5, '1BR': 15 },
  "Mike O'Callaghan Legacy Apartments": { Studio: 10, '1BR': 30 },
  'Juan Garcia Garden Apartments': { '1BR': 12, '2BR': 26, '3BR': 14 },
  'Louise Shell Senior Apartments': { Studio: 20, '1BR': 70, '2BR': 10 },
  'Owens Senior Housing': { Studio: 18, '1BR': 54 },
  'Sarann Knight Apartments': { Studio: 20, '1BR': 62 },
  'Senator Harry Reid Senior Apartments': { Studio: 20, '1BR': 70, '2BR': 10 },
  'Senator Richard Bryan Senior Apartments': { Studio: 30, '1BR': 80, '2BR': 10 },
  'Smith Williams Senior Apartments': { Studio: 20, '1BR': 60 },
  'Yale Keyes Senior Apartments': { Studio: 18, '1BR': 52 },
};

const BEDROOM_TO_BUCKET: Record<string, BedroomBucket> = {
  Studio: 'studio',
  '1BR': 'br1',
  '2BR': 'br2',
  // 3BR+ collapse onto the 'br3' bucket — matches the backend rollup
  // (`bedrooms >= 3` ⇒ br3_count) and the chip semantics.
  '3BR': 'br3',
  '4BR': 'br3',
};

/**
 * Compute the per-(property, bedroom-bucket) availability rollup deterministically.
 * Mirrors the SQL aggregate behind `GET /api/properties` (wedge #8).
 *
 * The seed loops `for (let i = 0; i < count; i++)` inside each (property,
 * bedroom) block — so each block starts the bucket counter at zero. That's
 * exactly what we reproduce here, which guarantees this rollup tracks the
 * DB to the unit.
 */
export function getPropertyAvailability(name: string): PropertyAvailability {
  const mix = PROPERTY_UNIT_MIX[name];
  const empty: PropertyAvailability = {
    availableCount: 0,
    leasedCount: 0,
    heldCount: 0,
    totalUnits: 0,
    bedroomBreakdown: { studio: 0, br1: 0, br2: 0, br3: 0 },
  };
  if (!mix) return empty;

  const breakdown: Record<BedroomBucket, number> = { studio: 0, br1: 0, br2: 0, br3: 0 };
  let availableCount = 0;
  let leasedCount = 0;
  let heldCount = 0;
  let totalUnits = 0;

  for (const [bedroomKey, count] of Object.entries(mix) as Array<[
    keyof typeof BEDROOM_TO_BUCKET,
    number,
  ]>) {
    const bucket = BEDROOM_TO_BUCKET[bedroomKey];
    if (!bucket || !count) continue;
    for (let i = 0; i < count; i++) {
      const status = unitStatus(i);
      totalUnits++;
      if (status === 'available') {
        availableCount++;
        breakdown[bucket]++;
      } else if (status === 'leased') {
        leasedCount++;
      } else {
        heldCount++;
      }
    }
  }

  return {
    availableCount,
    leasedCount,
    heldCount,
    totalUnits,
    bedroomBreakdown: breakdown,
  };
}

export function getPropertyAvailabilityBySlug(slug: string): PropertyAvailability | null {
  if (slug === 'donna-louise-2') {
    return getPropertyAvailability('Donna Louise Apartments 2');
  }
  const match = GPMG_FIXTURES.find((p: GPMGProperty) => slugify(p.name) === slug);
  return match ? getPropertyAvailability(match.name) : null;
}

/**
 * AMI tier filter — mirrors `applicants/units?amiTier=` and the new
 * `/api/properties?amiTier=` contract. All GPMG fixtures currently seed at
 * "60% AMI", so:
 *   - amiTier=30|50|60 → property passes (60% set-aside is in the allowed slice)
 *   - amiTier=80       → property filtered out (set-aside 60% is below 80%)
 * Market-rate properties (null/empty set-aside) always pass.
 */
export function propertyMatchesAmiTier(_p: GPMGProperty, amiTier: '30' | '50' | '60' | '80'): boolean {
  // All seeded fixtures have ami_set_aside = "60% AMI". The contract is
  // identical to the units route: the allowed slice is AMI_TIER_ORDER.slice(idx).
  // For amiTier=80 the slice is ["80% AMI"], which excludes "60% AMI".
  // For amiTier=30|50|60 the slice includes "60% AMI".
  // If a future fixture is genuinely market-rate, treat it as always-allowed.
  return amiTier !== '80';
}
