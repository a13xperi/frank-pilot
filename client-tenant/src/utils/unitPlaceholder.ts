/**
 * Placeholder imagery for properties/units that have no uploaded photo.
 *
 * We self-host a small set of generic apartment-exterior photos (see
 * `public/property-placeholders/`) rather than hotlinking a third-party service —
 * this avoids the flakiness and rate-limiting of placeholder services (e.g.
 * picsum.photos) and keeps the imagery licensing-safe (Pexels License, credited in
 * `property-placeholders/CREDITS.md`).
 *
 * Selection is deterministic on a caller-supplied `seed` (property slug/id, unit id)
 * so a given listing always renders the same photo across reloads and surfaces, while
 * a list of listings shows variety. Callers should pass a stable seed.
 *
 * Because these are *representative* photos and not the actual building, any surface
 * that renders a placeholder must label it — use `isPlaceholder()` to drive a
 * "Representative photo" badge, shown only on the fallback, never on a real photo.
 */

export const PROPERTY_PLACEHOLDERS: string[] = [
  '/property-placeholders/building-01.jpg',
  '/property-placeholders/building-02.jpg',
  '/property-placeholders/building-03.jpg',
  '/property-placeholders/building-04.jpg',
  '/property-placeholders/building-05.jpg',
  '/property-placeholders/building-06.jpg',
];

/** Ultimate fallback if the photo set is ever unavailable. */
export const UNIT_PLACEHOLDER_SVG = '/unit-placeholder.svg';

/**
 * Back-compat alias for the old single-asset export. Existing call sites that
 * don't pass a seed get a stable default photo.
 * @deprecated prefer `getUnitPhoto(photoUrl, seed)` with a stable seed.
 */
export const UNIT_PLACEHOLDER = PROPERTY_PLACEHOLDERS[0];

/** Small stable string hash (FNV-1a style) → non-negative int. */
function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Pick a deterministic placeholder photo from the set for a given seed. */
export function placeholderFor(seed?: string | number | null): string {
  if (seed === undefined || seed === null || seed === '') {
    return PROPERTY_PLACEHOLDERS[0];
  }
  const idx = hashSeed(String(seed)) % PROPERTY_PLACEHOLDERS.length;
  return PROPERTY_PLACEHOLDERS[idx];
}

/**
 * Returns the real photo URL if present, otherwise a deterministic placeholder
 * chosen from `seed`. With no seed, returns a stable default photo.
 */
export function getUnitPhoto(
  photoUrl: string | null | undefined,
  seed?: string | number | null,
): string {
  return photoUrl || placeholderFor(seed);
}

/** True when the given URL is one of our placeholders (drives the "Representative photo" label). */
export function isPlaceholder(url: string | null | undefined): boolean {
  if (!url) return true;
  return (
    url === UNIT_PLACEHOLDER_SVG ||
    PROPERTY_PLACEHOLDERS.includes(url) ||
    url.startsWith('/property-placeholders/')
  );
}
