import { api } from './client';
import { UNIT_PLACEHOLDER } from '@/utils/unitPlaceholder';

// ─── Wedge #8 — live `GET /api/properties` listing for /discover ──────────
//
// The server contract (`src/modules/properties/routes.ts:78-131`) zod-validates
// `amiTier`, `bedroom`, `availability` and returns `{ properties, total }` with
// a per-property availability rollup + rent range baked in. We don't redefine
// those semantics client-side — we just translate the chip state into the
// exact param names the server validates.
//
// `property:view` is admin-gated, so unauthed /discover users will see the
// 401 → catch path and the PropertyList falls back to GPMG_FIXTURES. That's
// the intentional contract: the live wire works for authed leasing agents
// (and the gpmglv demo) without breaking the public browse surface.

export type ApiAmiTier = '30' | '50' | '60' | '80';
export type ApiBedroomFilter = 'studio' | '1' | '2' | '3';
export type ApiAvailabilityFilter = 'available_now';

export interface ApiPropertyAvailability {
  availableCount: number;
  leasedCount: number;
  totalUnits: number;
  bedroomBreakdown: {
    studio: number;
    br1: number;
    br2: number;
    br3: number;
  };
}

export interface ApiRentBucket {
  low: number;
  high: number;
}

export interface ApiRentRange {
  studio: ApiRentBucket | null;
  br1: ApiRentBucket | null;
  br2: ApiRentBucket | null;
  br3: ApiRentBucket | null;
}

export interface ApiPropertyListing {
  id: string;
  name: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  zip: string;
  propertyType: 'senior' | 'family' | 'mixed_use';
  amiTier: string | null;
  availability: ApiPropertyAvailability;
  rentRange: ApiRentRange;
}

export interface PropertiesListResponse {
  properties: ApiPropertyListing[];
  total: number;
}

export interface PropertiesListFilters {
  amiTier?: ApiAmiTier;
  bedroom?: ApiBedroomFilter;
  availability?: ApiAvailabilityFilter;
}

/**
 * Live properties listing. Uses the SAME param names the server's zod schema
 * validates so any drift fails loudly (400 with `{ error, allowed }`) rather
 * than silently fetching the unfiltered list. Throws on any non-2xx so the
 * caller can fall back to the deterministic fixture render.
 */
export async function fetchPropertiesList(
  filters: PropertiesListFilters = {},
): Promise<PropertiesListResponse> {
  const params = new URLSearchParams();
  if (filters.amiTier) params.set('amiTier', filters.amiTier);
  if (filters.bedroom) params.set('bedroom', filters.bedroom);
  if (filters.availability) params.set('availability', filters.availability);
  const qs = params.toString();
  return api.get<PropertiesListResponse>(`/properties${qs ? `?${qs}` : ''}`);
}

export interface PropertyDetail {
  slug: string;
  name: string;
  address: string;
  city: string | null;
  state: string | null;
  neighborhood?: string | null;
  description?: string | null;
  photos: string[];
  amenities: string[];
  unitTypes: Array<{
    bed: string; // e.g. 'Studio', '1BR', '2BR'
    sqftRange: string; // e.g. '680'
    rent: number; // monthly
    available: boolean;
    waitMonths?: number;
  }>;
  rentMin: number;
  rentMax: number;
  amiBand?: string | null;
  community?: string | null;
  eligibility?: string[];
}

export interface WaitlistSummary {
  // Server returns "estimatedWindow"; we expose it under the legacy
  // property name `expectedNotificationWindow` too via the fetcher below so
  // existing call sites keep working. New code should read `estimatedWindow`.
  position?: number;
  totalQueue: number;
  movement?: { spotsThisMonth: number; direction: 'up' | 'down' | 'flat' } | null;
  estimatedWindow: string;
  expectedNotificationWindow: string;
  enrolled?: boolean;
}

// Donna Louise 2 — MVP fixture. Mirrors the DL2 data the prototype implies.
// When the server endpoint lands (Lane E or canonical BP-03), this is the
// fallback shape.
export const DL2_FIXTURE: PropertyDetail = {
  slug: 'donna-louise-2',
  name: 'Donna Louise 2',
  address: '4815 E Bonanza Rd',
  city: 'Las Vegas',
  state: 'NV',
  neighborhood: 'East Las Vegas',
  description:
    'Family-oriented community in East Las Vegas, walking distance to Garcia Elementary and Sunrise Hospital. Three-story building with elevator, on-site laundry, gated parking, and a courtyard with playground equipment. Section 8 vouchers welcome.',
  photos: [
    UNIT_PLACEHOLDER,
    UNIT_PLACEHOLDER,
    UNIT_PLACEHOLDER,
    UNIT_PLACEHOLDER,
    UNIT_PLACEHOLDER,
  ],
  amenities: [
    'Pool',
    'Elevator',
    'On-site laundry',
    'A/C',
    'Gated parking',
    'Courtyard',
    'Playground',
    'Accessible units',
  ],
  unitTypes: [
    { bed: '1BR', sqftRange: '680', rent: 740, available: false, waitMonths: 1 },
    { bed: '2BR', sqftRange: '905', rent: 920, available: false, waitMonths: 4 },
    { bed: '3BR', sqftRange: '1,150', rent: 1180, available: true, waitMonths: 0 },
  ],
  rentMin: 740,
  rentMax: 1180,
  amiBand: '50–60% AMI',
  community: 'Family',
  eligibility: [
    'Open to all household sizes',
    'All adult household members must apply',
    'Section 8 vouchers welcome',
    'Income limit: $42,150/yr for 4-person HH (50% AMI)',
  ],
};

export async function fetchProperty(slug: string): Promise<PropertyDetail> {
  try {
    return await api.get<PropertyDetail>(`/applicants/properties/${slug}`);
  } catch (e) {
    // Endpoint not live yet (Lane E / BP-03). Fall back to fixture for DL2.
    if (slug === 'donna-louise-2') return DL2_FIXTURE;
    throw e;
  }
}

// Wedge #5: the summary endpoint requires ?bedrooms now that it returns a real
// per-tier position. Callers without a tier (the discover banner) pass a
// sensible default; the Position page wires through the applicant's intent.
export async function fetchWaitlistSummary(
  slug: string,
  bedrooms = 2,
): Promise<WaitlistSummary> {
  try {
    const raw = await api.get<{
      position?: number;
      totalQueue: number;
      movement?: { spotsThisMonth: number; direction: 'up' | 'down' | 'flat' } | null;
      estimatedWindow: string;
      enrolled?: boolean;
    }>(`/applicants/properties/${slug}/waitlist-summary?bedrooms=${bedrooms}`);
    return {
      position: raw.position,
      totalQueue: raw.totalQueue,
      movement: raw.movement,
      estimatedWindow: raw.estimatedWindow,
      // Back-compat alias: a few legacy spots still read this field name.
      expectedNotificationWindow: raw.estimatedWindow,
      enrolled: raw.enrolled,
    };
  } catch {
    return {
      totalQueue: 38,
      estimatedWindow: '3–6 months',
      expectedNotificationWindow: '3–6 months',
    };
  }
}

export async function joinWaitlist(
  slug: string,
  bedrooms: number,
): Promise<WaitlistSummary> {
  const raw = await api.post<{
    position?: number;
    totalQueue: number;
    movement?: { spotsThisMonth: number; direction: 'up' | 'down' | 'flat' } | null;
    estimatedWindow: string;
    enrolled?: boolean;
  }>(`/applicants/properties/${slug}/waitlist-join`, { bedrooms });
  return {
    position: raw.position,
    totalQueue: raw.totalQueue,
    movement: raw.movement,
    estimatedWindow: raw.estimatedWindow,
    expectedNotificationWindow: raw.estimatedWindow,
    enrolled: raw.enrolled,
  };
}

export async function leaveWaitlist(slug: string, bedrooms: number): Promise<void> {
  await api.del<{ ok: true }>(
    `/applicants/properties/${slug}/waitlist-leave?bedrooms=${bedrooms}`,
  );
}
