/**
 * NV city → QAP geographic account resolver (backend).
 *
 * The Nevada 2026 QAP splits the credit ceiling across three geographic
 * accounts — Clark (54%), Washoe (29%), Balance-of-State (17%) — and competes
 * projects WITHIN their account. Funnel properties carry a `city` but no
 * account, so the Demand-Evidence Engine maps city → account here.
 *
 * This intentionally mirrors `client-tenant/src/lib/nv-counties.ts`
 * (`cityToCountyKey`) — the funnel's Clark city set is reused verbatim so the
 * acquisitions layer and the tenant funnel agree on which cities are Clark.
 * Where the funnel returns null for non-Clark cities (it only ingested Clark
 * limits), the QAP layer must classify every NV city, so Washoe cities map to
 * WASHOE and everything else falls through to OTHER (Balance of State).
 */
import type { GeographicAccount } from './qap-2026';

/** Incorporated cities + CDPs in Clark County, NV. Lowercased. */
const CLARK_CITIES: ReadonlySet<string> = new Set([
  'las vegas',
  'north las vegas',
  'henderson',
  'boulder city',
  'mesquite',
  'laughlin',
  'enterprise',
  'spring valley',
  'sunrise manor',
  'paradise',
  'summerlin',
  'whitney',
  'winchester',
]);

/** Incorporated cities + CDPs in Washoe County, NV. Lowercased. */
const WASHOE_CITIES: ReadonlySet<string> = new Set([
  'reno',
  'sparks',
  'sun valley',
  'spanish springs',
  'incline village',
  'verdi',
  'cold springs',
  'lemmon valley',
  'golden valley',
]);

function normalize(city: string | null | undefined): string | null {
  if (!city) return null;
  const key = city.trim().toLowerCase();
  return key.length > 0 ? key : null;
}

/**
 * Resolve a property's `city` to its QAP geographic account. Unlike the
 * funnel's `cityToCountyKey` (which returns null outside Clark), this always
 * classifies: non-Clark, non-Washoe NV cities are Balance-of-State (OTHER).
 * Case- and whitespace-insensitive. A null/blank city is OTHER (the
 * conservative default — Balance of State is the residual account).
 */
export function cityToGeographicAccount(
  city: string | null | undefined,
): GeographicAccount {
  const key = normalize(city);
  if (key && CLARK_CITIES.has(key)) return 'CLARK';
  if (key && WASHOE_CITIES.has(key)) return 'WASHOE';
  return 'OTHER';
}
