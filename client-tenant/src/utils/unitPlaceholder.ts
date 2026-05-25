/**
 * Placeholder imagery for properties/units that have no uploaded photo.
 *
 * Rather than show a real-but-not-the-actual-building stock photo (a
 * misrepresentation risk on a fair-housing site, even when labelled), we
 * generate an honest-by-design **neutral brand placeholder**: a warm brand
 * gradient + a geometric building glyph + the property's short name. It is
 * self-evidently not a photograph, carries no licensing, and needs no network
 * request (inline `data:image/svg+xml` URI).
 *
 * Selection is deterministic on a caller-supplied `seed` (property slug/id, unit
 * id) so a given listing always renders the same panel across reloads and
 * surfaces, while a list of listings shows on-brand variety (the gradient is
 * picked from the seed). An optional `label` (the property name) drives the
 * name word; with no label the panel is glyph-only.
 *
 * NOTE: the legacy static map (`public/nv-housing-map.html`) and the social OG
 * tags still reference the old `/property-placeholders/*.jpg` and
 * `/unit-placeholder.svg` assets directly — those files are intentionally kept.
 * `isPlaceholder()` therefore still recognises them for back-compat.
 */

/** Small stable string hash (FNV-1a style) → non-negative int. Mirrors propertyProfile.ts. */
function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** On-brand 2-stop gradients (dark enough for white text). Ported from HF tokens. */
const GRADIENTS: ReadonlyArray<readonly [string, string]> = [
  ['#C9492A', '#7A2A18'], // terracotta — accent → accentInk
  ['#5C7A4F', '#3A4F31'], // sage
  ['#4A4338', '#1F1A12'], // cocoa — ink2 → ink
  ['#B0673E', '#7A3A1F'], // warm clay
];

/** Generic words stripped when deriving the name word, so the proper noun wins. */
const STOPWORDS = new Set([
  'family', 'community', 'communities', 'senior', 'seniors', 'housing',
  'apartments', 'apartment', 'homes', 'home', 'the', 'villas', 'villa',
  'manor', 'estates', 'estate', 'gardens', 'garden', 'place', 'residences',
  'residence', 'at', 'of', 'and', 'court', 'courts', 'village', 'terrace',
  'towers', 'tower', 'plaza', 'commons', 'lofts', 'square',
]);

/**
 * Derive a single prominent short name word from a property name.
 * "David J. Hoggard Family Community" → "HOGGARD", "Owens Senior Housing" →
 * "OWENS", "Donna Louise 2" → "LOUISE". Empty string when no usable word.
 */
export function nameWord(label?: string | null): string {
  if (!label) return '';
  const tokens = label
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const candidates = tokens.filter(
    (tok) => tok.length >= 2 && !/^\d+$/.test(tok) && !STOPWORDS.has(tok.toLowerCase()),
  );
  const pool = candidates.length ? candidates : tokens.filter((t) => t.length >= 2);
  if (!pool.length) return '';
  // Longest wins (most distinctive); first on a tie.
  const best = pool.reduce((a, b) => (b.length > a.length ? b : a));
  return best.toUpperCase().slice(0, 10);
}

/** SVG-escape text content (property names are user-facing strings). */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Build the inline SVG (1200×675, 16:9) for a given seed + optional name word. */
function buildPlaceholderSvg(seed: string, label?: string | null): string {
  const h = hashSeed(seed);
  const [from, to] = GRADIENTS[h % GRADIENTS.length];
  const id = `g${h % 100000}`;
  const word = nameWord(label);

  // Geometric building glyph — a tower with a window grid, white at low opacity.
  // Centred horizontally, sitting in the upper-middle so the name word reads below.
  const bx = 510;
  const by = 150;
  const bw = 180;
  const bh = 250;
  let windows = '';
  const cols = 3;
  const rows = 5;
  const ww = 28;
  const wh = 28;
  const gapX = (bw - cols * ww) / (cols + 1);
  const gapY = (bh - rows * wh) / (rows + 1);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const wx = bx + gapX + c * (ww + gapX);
      const wy = by + gapY + r * (wh + gapY);
      windows += `<rect x="${wx.toFixed(0)}" y="${wy.toFixed(0)}" width="${ww}" height="${wh}" rx="3" fill="#FFFFFF" opacity="0.16"/>`;
    }
  }
  const glyph =
    `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="8" fill="#FFFFFF" opacity="0.12"/>` +
    windows;

  // Name word — clamp size to length so long names still fit.
  const fontSize = word.length <= 6 ? 132 : word.length <= 8 ? 108 : 88;
  const text = word
    ? `<text x="600" y="540" text-anchor="middle" font-family="Manrope, -apple-system, system-ui, sans-serif" font-weight="800" font-size="${fontSize}" letter-spacing="4" fill="#FFFFFF" fill-opacity="0.92">${esc(word)}</text>`
    : '';

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 675" width="1200" height="675">` +
    `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>` +
    `</linearGradient></defs>` +
    `<rect width="1200" height="675" fill="url(#${id})"/>` +
    glyph +
    text +
    `</svg>`;

  // Encode for use in both CSS `url(...)` and `<img src>`. encodeURIComponent
  // leaves ( ) ' unescaped — escape parens too so CSS `url()` never breaks.
  const encoded = encodeURIComponent(svg).replace(/\(/g, '%28').replace(/\)/g, '%29');
  return `data:image/svg+xml,${encoded}`;
}

/**
 * Deterministic neutral brand placeholder for a given seed. Pass the property
 * name as `label` to render its short name word; omit it for a glyph-only panel.
 */
export function placeholderFor(
  seed?: string | number | null,
  label?: string | null,
): string {
  const s = seed === undefined || seed === null ? '' : String(seed);
  return buildPlaceholderSvg(s, label);
}

/**
 * Returns the real photo URL if present, otherwise a deterministic neutral
 * placeholder generated from `seed` (+ optional `label`).
 */
export function getUnitPhoto(
  photoUrl: string | null | undefined,
  seed?: string | number | null,
  label?: string | null,
): string {
  return photoUrl || placeholderFor(seed, label);
}

/**
 * Back-compat alias for the old single-asset export.
 * @deprecated prefer `placeholderFor(seed, label)` with a stable seed.
 */
export const UNIT_PLACEHOLDER = placeholderFor('');

/** Legacy asset paths still referenced by the static map + OG tags (kept for back-compat detection). */
const LEGACY_PLACEHOLDER_PREFIXES = ['/property-placeholders/', '/unit-placeholder.svg'];

/** True when the given URL is one of our placeholders (real photo ⇒ false). */
export function isPlaceholder(url: string | null | undefined): boolean {
  if (!url) return true;
  return (
    url.startsWith('data:image/svg+xml') ||
    LEGACY_PLACEHOLDER_PREFIXES.some((p) => url === p || url.startsWith(p))
  );
}
