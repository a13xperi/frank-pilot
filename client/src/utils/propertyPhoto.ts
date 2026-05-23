/**
 * Property thumbnail source with a self-hosted placeholder.
 *
 * `/api/properties` does not yet return a photo. This helper is forward-wired:
 * once the backend adds a `photoUrl` to the Property payload, real photos
 * appear automatically with no further UI change. Until then every row shows
 * a neutral building placeholder (an inline SVG data-URI — no asset file or
 * public/ dir needed, works identically in dev and production builds).
 */
const PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
  <rect width="48" height="48" rx="8" fill="#f3f4f6"/>
  <path fill="#9ca3af" d="M15 34V18l9-5 9 5v16h-5v-7h-8v7z"/>
  <rect x="18" y="21" width="3" height="3" rx="0.5" fill="#f3f4f6"/>
  <rect x="27" y="21" width="3" height="3" rx="0.5" fill="#f3f4f6"/>
</svg>`;

export const PROPERTY_PLACEHOLDER =
  'data:image/svg+xml;utf8,' + encodeURIComponent(PLACEHOLDER_SVG);

export function getPropertyPhoto(photoUrl: string | null | undefined): string {
  return photoUrl || PROPERTY_PLACEHOLDER;
}
