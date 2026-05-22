/**
 * Returns a photo URL for a unit, falling back to a self-hosted SVG placeholder
 * when no photo has been uploaded. Using a local asset avoids the flakiness and
 * rate-limiting of third-party placeholder services (e.g. picsum.photos).
 */
export const UNIT_PLACEHOLDER = '/unit-placeholder.svg';

export function getUnitPhoto(photoUrl: string | null | undefined): string {
  return photoUrl || UNIT_PLACEHOLDER;
}
