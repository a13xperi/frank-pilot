import { api } from './client';

export interface Intent {
  bedrooms: number;
  budget_min?: number;
  budget_max: number;
  move_in_date: string;
  household_size: number;
  property_id?: string;
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
  maxRent?: number;
  moveInBy?: string;
  propertyId?: string;
}): Promise<{ units: Unit[] }> {
  const params = new URLSearchParams();
  if (filter.bedrooms !== undefined) params.set('bedrooms', String(filter.bedrooms));
  if (filter.maxRent !== undefined) params.set('maxRent', String(filter.maxRent));
  if (filter.moveInBy) params.set('moveInBy', filter.moveInBy);
  if (filter.propertyId) params.set('propertyId', filter.propertyId);
  const qs = params.toString();
  return api.get(`/applicants/units${qs ? `?${qs}` : ''}`);
}

export async function claimUnit(unitId: string): Promise<ClaimResponse> {
  return api.post(`/applicants/claim-unit/${unitId}`);
}

export async function releaseClaim(): Promise<{ ok: boolean }> {
  return api.del('/applicants/claim-unit');
}
