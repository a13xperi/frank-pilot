import { api } from './client';
import { UNIT_PLACEHOLDER } from '@/utils/unitPlaceholder';

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
  position: number;
  totalQueue: number;
  expectedNotificationWindow: string;
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

export async function fetchWaitlistSummary(slug: string): Promise<WaitlistSummary> {
  try {
    return await api.get<WaitlistSummary>(`/applicants/properties/${slug}/waitlist-summary`);
  } catch {
    return { position: 38, totalQueue: 38, expectedNotificationWindow: '3–6 months' };
  }
}
