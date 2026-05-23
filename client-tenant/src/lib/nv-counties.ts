/**
 * NV city → county-key resolver for the 2026 limits dataset.
 *
 * Property fixtures carry a `city` but no county; LIHTC income/rent limits are
 * published per county. This maps the Clark County cities (the only county
 * ingested today) to their `CountyKey`. Every other NV city returns null so
 * PropertyDetail shows "limits coming soon" rather than stale numbers.
 *
 * To extend statewide: ingest the county's Novogradac export (drop a
 * <county>-2026.json next to clark-2026.json, re-run `npm run ingest:limits`)
 * and add its cities here. See the queued statewide-scrape follow-up.
 */
import { type CountyKey } from './limits-2026.generated';

/** Incorporated cities + CDPs that fall in Clark County, NV. Lowercased. */
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

/**
 * Resolve a property's `city` to the county key whose limits dataset applies,
 * or null when that county has not been ingested yet (→ "coming soon" in the
 * UI). Case- and whitespace-insensitive.
 */
export function cityToCountyKey(
  city: string | null | undefined,
): CountyKey | null {
  if (!city) return null;
  const key = city.trim().toLowerCase();
  if (CLARK_CITIES.has(key)) return 'CLARK';
  return null;
}
