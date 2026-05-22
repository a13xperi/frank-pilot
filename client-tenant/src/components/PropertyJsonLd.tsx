/**
 * wedge #14 — RealEstateListing structured data for property detail pages.
 *
 * Injects a single `<script type="application/ld+json" data-jsonld="property">`
 * element into <head> while the host page is mounted, and removes it on
 * unmount. Effect-based DOM injection because `react-helmet-async` is not on
 * the dep tree (and we don't want to add it just for one tag).
 *
 * The schema combines schema.org/Apartment + schema.org/Offer with one
 * `UnitPriceSpecification` per populated bedroom bucket, sourced from
 * `utils/pricing` (the same mirror that powers the wedge #9 rent disclosure
 * — so what Google sees matches what the user sees).
 *
 * Fields we deliberately skip because GPMG fixtures don't carry them:
 *   - description (no per-property blurb)
 *   - image (no real photography yet — placeholder excluded to avoid lying
 *     in rich results)
 *   - amenityFeature (no structured amenity data; the UI list is static
 *     and identical across all 17 properties — not worth surfacing)
 *   - numberOfRooms / petsAllowed (not in the fixture shape)
 * Enrich here once those fields land upstream.
 */

import { useEffect } from 'react';
import type { GPMGProperty } from '@/api/gpmg-fixtures';
import {
  propertyRentRange,
  populatedBuckets,
  type BedroomBucket,
} from '@/utils/pricing';

interface Props {
  property: GPMGProperty;
}

const BEDROOM_LABEL: Record<BedroomBucket, string> = {
  studio: 'Studio',
  br1: '1 Bedroom',
  br2: '2 Bedroom',
  br3: '3+ Bedroom',
};

/**
 * Build the JSON-LD payload for a single property. Exported for unit testing.
 */
export function buildPropertyJsonLd(p: GPMGProperty): Record<string, unknown> {
  const range = propertyRentRange(p.name);
  const buckets = populatedBuckets(range);

  const priceSpecification = buckets.map(({ key, bucket }) => ({
    '@type': 'UnitPriceSpecification',
    name: BEDROOM_LABEL[key],
    price: bucket.low,
    priceCurrency: 'USD',
    unitText: 'MONTHLY',
    ...(bucket.high !== bucket.low ? { maxPrice: bucket.high } : {}),
  }));

  const offers =
    priceSpecification.length > 0
      ? {
          '@type': 'Offer',
          priceCurrency: 'USD',
          priceSpecification,
          availability: 'https://schema.org/InStock',
        }
      : undefined;

  const payload: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Apartment',
    name: p.name,
    address: {
      '@type': 'PostalAddress',
      streetAddress: p.addr,
      addressLocality: p.city,
      addressRegion: 'NV',
      postalCode: p.zip,
      addressCountry: 'US',
    },
  };

  if (typeof p.units === 'number') {
    payload.numberOfRooms = p.units;
  }

  if (p.phone) {
    payload.telephone = p.phone;
  }

  if (offers) {
    payload.offers = offers;
  }

  return payload;
}

const SCRIPT_ATTR = 'data-jsonld-property';

export function PropertyJsonLd({ property }: Props) {
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const payload = buildPropertyJsonLd(property);
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.setAttribute(SCRIPT_ATTR, '');
    script.textContent = JSON.stringify(payload);
    document.head.appendChild(script);

    return () => {
      // Use the live reference; querySelector cleanup is safer against
      // hot-reload double-mounts in dev.
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    };
  }, [property]);

  return null;
}
