import { api } from './client';

// ─── Saved-property shortlist (guest-first wishlist) ──────────────────────
//
// Backend mounted at /api/saved (src/modules/saved). A guest's saves are
// keyed to an httpOnly `uh_guest` cookie that the shared `request()` helper
// already round-trips (credentials:'include'). The cookie is set server-side
// on a guest's first save and is migrated onto the user record on magic-link
// conversion — so the same list survives the applicant→tenant transition.
//
// `propertyId` is a slug OR a uuid; /discover renders by slug (route
// /property/:slug) so the UI always saves using the slug.

export interface SavedItem {
  id: string;
  propertyId: string;
  propertySlug: string;
  listName: string;
  alertEnabled: boolean;
  createdAt: string;
}

export interface SavedListItem extends SavedItem {
  name: string;
  rentMin: number | null;
  rentMax: number | null;
  amiTier: string | null;
  availableCount: number;
}

export interface SavedListGroup {
  listName: string;
  items: SavedListItem[];
}

export interface CompareProperty {
  propertyId: string;
  slug: string;
  name: string;
  city: string;
  amiTier: string | null;
  rentMin: number | null;
  rentMax: number | null;
  availableCount: number;
}

export interface ShortlistResponse {
  lists: SavedListGroup[];
  count: number;
}

/** Save a property to the guest's shortlist (sets the guest cookie on first save). */
export async function saveProperty(
  propertyId: string,
  listName?: string,
): Promise<SavedItem> {
  const res = await api.post<{ saved: SavedItem }>('/saved', {
    propertyId,
    ...(listName ? { listName } : {}),
  });
  return res.saved;
}

/** Remove a property from the shortlist. Scoped to `listName` when given. */
export async function unsaveProperty(
  propertyId: string,
  listName?: string,
): Promise<{ ok: true; removed: number }> {
  const qs = listName ? `?listName=${encodeURIComponent(listName)}` : '';
  return api.del<{ ok: true; removed: number }>(
    `/saved/${encodeURIComponent(propertyId)}${qs}`,
  );
}

/** Load the full shortlist, grouped by list name, with the total count. */
export async function getShortlist(): Promise<ShortlistResponse> {
  return api.get<ShortlistResponse>('/saved');
}

/** Toggle the vacancy alert for a saved property. */
export async function toggleAlert(
  propertyId: string,
  enabled: boolean,
): Promise<SavedItem> {
  const res = await api.patch<{ saved: SavedItem }>(
    `/saved/${encodeURIComponent(propertyId)}/alert`,
    { enabled },
  );
  return res.saved;
}

/** Fetch a comparison payload for a set of saved properties. */
export async function compareSaved(ids: string[]): Promise<CompareProperty[]> {
  const param = ids.map((id) => encodeURIComponent(id)).join(',');
  const res = await api.get<{ properties: CompareProperty[] }>(
    `/saved/compare?ids=${param}`,
  );
  return res.properties;
}
