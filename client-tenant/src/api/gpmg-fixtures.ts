/**
 * GPMG Las Vegas property fixtures — 17 affordable communities.
 *
 * Sourced from the public GPMG catalog. Used as the client-side data source
 * for the public `/discover` browse page because the canonical
 * `GET /api/properties` route requires `property:view` auth. This fixture is
 * the MVP carry-over until a public discovery endpoint lands.
 */

export type GPMGType = 'senior' | 'family';

export interface GPMGProperty {
  /** Display name. */
  name: string;
  /** Street address line. */
  addr: string;
  /** City. */
  city: 'Las Vegas' | 'North Las Vegas' | 'Henderson';
  /** ZIP. */
  zip: string;
  /** Phone (formatted). */
  phone: string;
  /** Contact email — null if not published. */
  email: string | null;
  /** Unit count — null if not published. */
  units: number | null;
  /** Senior or family community. */
  type: GPMGType;
}

export const GPMG_FIXTURES: readonly GPMGProperty[] = [
  { name: 'Aldene Kline Barlow Senior Apartments', addr: '1327 H St.', city: 'Las Vegas', zip: '89106', phone: '(702) 920-6550', email: 'barlow@gpmglv.org', units: 39, type: 'senior' },
  { name: 'David J. Hoggard Family Community', addr: '1100 W. Monroe Ave.', city: 'Las Vegas', zip: '89106', phone: '(702) 631-2281', email: 'hoggard@gpmglv.org', units: 100, type: 'family' },
  { name: 'Donna Louise Apartments', addr: '6225 Donna St.', city: 'North Las Vegas', zip: '89081', phone: '(702) 920-6548', email: 'donnalouise@gpmglv.org', units: 48, type: 'family' },
  { name: 'Donna Louise Apartments 2', addr: '6225 Donna St.', city: 'North Las Vegas', zip: '89081', phone: '(702) 920-6548', email: 'donnalouise@gpmglv.org', units: null, type: 'family' },
  { name: 'Luther Mack, Jr. Senior Apartments', addr: '8158 Giles St.', city: 'Las Vegas', zip: '89123', phone: '(702) 920-6569', email: 'drluthermack@gpmglv.org', units: 48, type: 'senior' },
  { name: 'Dr. Paul Meacham Senior Community', addr: '65 E Windmill Ln', city: 'Las Vegas', zip: '89123', phone: '(877) 895-8207', email: 'paulmeacham@gpmglv.org', units: 57, type: 'senior' },
  { name: 'Ethel Mae Fletcher Apartments', addr: '1503 Laurelhurst Dr.', city: 'Las Vegas', zip: '89108', phone: '(702) 920-6572', email: 'ethelmaefletcher@gpmglv.org', units: 42, type: 'senior' },
  { name: 'Ethel Mae Robinson Senior Apartments', addr: '1327 H Street', city: 'Las Vegas', zip: '89106', phone: '(702) 648-6800', email: 'ethelmaerobinson@gpmglv.org', units: 20, type: 'senior' },
  { name: "Mike O'Callaghan Legacy Apartments", addr: '1502 Laurelhurst Dr', city: 'Las Vegas', zip: '89108', phone: '(725) 735-7779', email: 'mikeocallaghan@gpmglv.org', units: 40, type: 'senior' },
  { name: 'Juan Garcia Garden Apartments', addr: '2851 Sunrise Ave.', city: 'Las Vegas', zip: '89101', phone: '(725) 735-7779', email: 'juangarcia@gpmglv.org', units: 52, type: 'family' },
  { name: 'Louise Shell Senior Apartments', addr: '2101 N. Martin Luther King Blvd.', city: 'Las Vegas', zip: '89106', phone: '(702) 648-6800', email: 'louiseshell@gpmglv.org', units: 100, type: 'senior' },
  { name: 'Owens Senior Housing', addr: '1626 Davis Pl.', city: 'North Las Vegas', zip: '89030', phone: '(702) 642-0896', email: 'owens@gpmglv.org', units: 72, type: 'senior' },
  { name: 'Sarann Knight Apartments', addr: '1327 H Street', city: 'Las Vegas', zip: '89106', phone: '(702) 538-9031', email: 'sarannknight@gpmglv.org', units: 82, type: 'senior' },
  { name: 'Senator Harry Reid Senior Apartments', addr: '328 N. 11th St', city: 'Las Vegas', zip: '89101', phone: '(702) 383-1091', email: 'harryreid@gpmglv.org', units: 100, type: 'senior' },
  { name: 'Senator Richard Bryan Senior Apartments', addr: '2651 Searles Ave.', city: 'Las Vegas', zip: '89101', phone: '(702) 649-3508', email: 'senatorrichardbryan@gpmglv.org', units: 120, type: 'senior' },
  { name: 'Smith Williams Senior Apartments', addr: '575 E. Lake Mead Pkwy.', city: 'Henderson', zip: '89015', phone: '(702) 382-3726', email: null, units: 80, type: 'senior' },
  { name: 'Yale Keyes Senior Apartments', addr: '1705 Yale Str.', city: 'North Las Vegas', zip: '89030', phone: '(702) 642-7758', email: null, units: 70, type: 'senior' },
] as const;

/** kebab-case a property name into a URL slug. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Find a fixture by URL slug. Also matches the legacy DL2 slug
 * `donna-louise-2` (kept working as a hand-mapped alias from the MVP).
 */
export function findGPMGBySlug(slug: string): GPMGProperty | undefined {
  if (slug === 'donna-louise-2') {
    return GPMG_FIXTURES.find((p) => p.name === 'Donna Louise Apartments 2');
  }
  return GPMG_FIXTURES.find((p) => slugify(p.name) === slug);
}

/**
 * Rough "from $X/mo" estimate — GPMG publishes ranges only via PDFs and the
 * catalog doesn't expose per-unit rent, so we surface a conservative number
 * for the tile until a real rent endpoint lands.
 */
export function rentEstimate(p: GPMGProperty): number {
  return p.type === 'senior' ? 747 : 920;
}
