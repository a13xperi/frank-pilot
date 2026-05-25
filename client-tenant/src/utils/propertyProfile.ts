/**
 * Representative property profile — pilot data for the detail page.
 *
 * The GPMG catalog (`gpmg-fixtures.ts`) publishes name/address/phone/units/type
 * only. The detail page's richer sections (floor-plan unit sizes, amenity chips,
 * neighborhood walk/transit/quiet estimates) have no public source, so we derive
 * them deterministically from the property slug. Same property → same profile on
 * every load and surface; different properties get sensible variety.
 *
 * These values are *representative*, not measured — every section that renders
 * them carries a "representative" disclosure (fair-housing / advertising hygiene,
 * matching the "Representative photo" treatment on the hero). Rents and live
 * availability shown alongside come from the real seeded rollups
 * (`utils/pricing.ts`, `utils/availability.ts`) and are NOT generated here.
 *
 * Selection is a pure function of the seed via the same FNV-1a hash used for
 * placeholder photos (`utils/unitPlaceholder.ts`) — no Math.random, no per-render
 * churn.
 */

import type { GPMGType } from '@/api/gpmg-fixtures';
import type { BedroomBucket } from '@/utils/availability';

/** FNV-1a string hash → non-negative 32-bit int (mirrors unitPlaceholder.ts). */
function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic integer in [min, max] from a seed string. */
function seededInt(seed: string, min: number, max: number): number {
  const span = max - min + 1;
  return min + (hashSeed(seed) % span);
}

// ---------------------------------------------------------------------------
// Floor-plan unit sizes (representative)
// ---------------------------------------------------------------------------

/** Typical interior size per bedroom bucket, in sq ft. Anchors the variance. */
const BASE_SQFT: Record<BedroomBucket, number> = {
  studio: 520,
  br1: 680,
  br2: 920,
  br3: 1150,
};

/**
 * Representative unit size for a (property, bedroom) pair, rounded to the
 * nearest 10 sq ft. Varies up to ~±6% around the bedroom-type anchor, seeded
 * by slug+bucket so each property reads slightly differently but stably.
 */
export function representativeSqft(slug: string, bucket: BedroomBucket): number {
  const base = BASE_SQFT[bucket];
  const delta = seededInt(`${slug}:${bucket}:sqft`, -1, 1) * seededInt(`${slug}:${bucket}:mag`, 20, 60);
  return Math.round((base + delta) / 10) * 10;
}

// ---------------------------------------------------------------------------
// Amenities (representative)
// ---------------------------------------------------------------------------

/** Amenity keys → i18n label keys live under `amenities.item.<key>`. */
export type AmenityKey =
  | 'laundry'
  | 'manager'
  | 'smokefree'
  | 'transit'
  | 'elevator'
  | 'accessible'
  | 'community'
  | 'parking'
  | 'ac'
  | 'courtyard'
  | 'playground'
  | 'pool';

// Always-present, defensible for every GPMG community.
const CORE_AMENITIES: readonly AmenityKey[] = ['laundry', 'manager', 'smokefree', 'transit'];

// Type-appropriate extras we pick a stable subset from.
const SENIOR_EXTRAS: readonly AmenityKey[] = ['elevator', 'accessible', 'community', 'parking', 'ac', 'courtyard'];
const FAMILY_EXTRAS: readonly AmenityKey[] = ['playground', 'courtyard', 'community', 'parking', 'ac', 'pool'];

/**
 * Representative amenity chips for a property: the four core amenities plus a
 * deterministic subset of type-appropriate extras (4 of them), so seniors and
 * families read differently and each property shows some variety. Returned in
 * a stable display order.
 */
export function representativeAmenities(slug: string, type: GPMGType): AmenityKey[] {
  const pool = [...(type === 'senior' ? SENIOR_EXTRAS : FAMILY_EXTRAS)];
  // Deterministic shuffle (Fisher–Yates seeded by slug), then take 4.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = seededInt(`${slug}:amen:${i}`, 0, i);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const chosen = new Set<AmenityKey>([...CORE_AMENITIES, ...pool.slice(0, 4)]);
  // Stable display order across the union.
  const ORDER: readonly AmenityKey[] = [
    'laundry', 'elevator', 'accessible', 'parking', 'ac',
    'courtyard', 'playground', 'pool', 'community', 'manager', 'transit', 'smokefree',
  ];
  return ORDER.filter((k) => chosen.has(k));
}

// ---------------------------------------------------------------------------
// Neighborhood (representative)
// ---------------------------------------------------------------------------

export type NearbyKind = 'park' | 'school' | 'grocery' | 'transit' | 'pharmacy';

export interface NeighborhoodProfile {
  /** 0–100 representative walkability / transit / quiet scores. */
  walk: number;
  transit: number;
  quiet: number;
  /** A few nearby points of interest with representative distances (miles). */
  nearby: Array<{ kind: NearbyKind; miles: number }>;
}

const NEARBY_KINDS: readonly NearbyKind[] = ['park', 'school', 'grocery', 'transit', 'pharmacy'];

/**
 * Representative neighborhood profile, seeded by slug. Scores land in a
 * plausible urban band (45–88) rather than 0–100 extremes; distances are
 * tenths of a mile. Neutral framing ("Walkability", not the trademarked
 * Walk Score®) — these are estimates, labelled as such at the call site.
 */
export function representativeNeighborhood(slug: string): NeighborhoodProfile {
  const walk = seededInt(`${slug}:walk`, 48, 86);
  const transit = seededInt(`${slug}:transit`, 45, 82);
  const quiet = seededInt(`${slug}:quiet`, 52, 88);
  // Pick 4 of the 5 nearby kinds, deterministically, each with a 0.1–0.9 mi distance.
  const drop = seededInt(`${slug}:nearby:drop`, 0, NEARBY_KINDS.length - 1);
  const nearby = NEARBY_KINDS.filter((_, i) => i !== drop).map((kind) => ({
    kind,
    miles: seededInt(`${slug}:nearby:${kind}`, 1, 9) / 10,
  }));
  return { walk, transit, quiet, nearby };
}
