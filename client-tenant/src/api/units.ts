import { api } from './client';

export type AmiTier = '30' | '50' | '60' | '80';

export interface Intent {
  bedrooms: number;
  budget_min?: number;
  budget_max: number;
  move_in_date: string;
  household_size: number;
  // W0 — both optional; null `qualifying_ami_tier` means "applicant submitted
  // income but is over-income for the highest tier" (vs. undefined meaning
  // "no income provided, leave existing draft values alone…or clear them").
  gross_annual_income?: number | null;
  qualifying_ami_tier?: AmiTier | null;
}

export interface Unit {
  id: string;
  property_id: string;
  unit_number: string;
  bedrooms: number;
  bathrooms: string | number;
  sqft: number | null;
  monthly_rent: string | number;
  photo_url: string | null;
  available_from: string | null;
  property_name: string;
  property_city: string | null;
  property_state: string | null;
}

export interface ClaimResponse {
  ok: true;
  unit: Unit;
  expires_at: string;
  application_id: string;
}

export async function saveIntent(intent: Intent): Promise<{ ok: boolean; application_id: string }> {
  return api.post('/applicants/intent', intent);
}

export async function fetchUnits(filter: {
  bedrooms?: number;
  // Inclusive — use this for "N+ BR" semantics so the user actually sees
  // units at higher bedroom counts (the dropdown's "4+ BR" option, etc.).
  bedroomsMin?: number;
  maxRent?: number;
  moveInBy?: string;
  propertyId?: string;
  // W0 — applicant's lowest qualifying tier. Omit (or pass undefined) to see
  // all units; the backend treats a missing param as permissive.
  amiTier?: AmiTier;
}): Promise<{ units: Unit[] }> {
  const params = new URLSearchParams();
  if (filter.bedroomsMin !== undefined) params.set('bedroomsMin', String(filter.bedroomsMin));
  else if (filter.bedrooms !== undefined) params.set('bedrooms', String(filter.bedrooms));
  if (filter.maxRent !== undefined) params.set('maxRent', String(filter.maxRent));
  if (filter.moveInBy) params.set('moveInBy', filter.moveInBy);
  if (filter.propertyId) params.set('propertyId', filter.propertyId);
  if (filter.amiTier) params.set('amiTier', filter.amiTier);
  const qs = params.toString();
  return api.get(`/applicants/units${qs ? `?${qs}` : ''}`);
}

export async function claimUnit(unitId: string): Promise<ClaimResponse> {
  return api.post(`/applicants/claim-unit/${unitId}`);
}

export async function releaseClaim(): Promise<{ ok: boolean }> {
  return api.del('/applicants/claim-unit');
}
