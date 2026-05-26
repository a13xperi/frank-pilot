/**
 * City landing page structured data — a schema.org `CollectionPage` whose
 * `mainEntity` is an `ItemList` of the city's properties, each pointing at its
 * `/property/{slug}` detail page (which carries its own `Apartment` JSON-LD).
 *
 * Same effect-based injection as {@link PropertyJsonLd} (no react-helmet on the
 * dep tree): append one `<script data-jsonld-city>` to <head> while mounted,
 * remove on unmount. Keeps Google's view of a city page aligned with the
 * crawlable list the user sees.
 */

import { useEffect } from 'react';
import { GPMG_FIXTURES, slugify, type GPMGProperty } from '@/api/gpmg-fixtures';

interface Props {
  /** Canonical city name, e.g. "Las Vegas". */
  city: string;
  /** Properties shown on the page (already filtered to the city). */
  properties: readonly GPMGProperty[];
  /** Absolute origin for building canonical item URLs. */
  origin: string;
}

/** Build the CollectionPage + ItemList payload. Exported for unit testing. */
export function buildCityJsonLd(
  city: string,
  properties: readonly GPMGProperty[],
  origin: string,
): Record<string, unknown> {
  const itemListElement = properties.map((p, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    url: `${origin}/property/${slugify(p.name)}`,
    name: p.name,
  }));

  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `Affordable housing in ${city}, NV`,
    about: {
      '@type': 'Place',
      address: {
        '@type': 'PostalAddress',
        addressLocality: city,
        addressRegion: 'NV',
        addressCountry: 'US',
      },
    },
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: properties.length,
      itemListElement,
    },
  };
}

const SCRIPT_ATTR = 'data-jsonld-city';

export function CityJsonLd({ city, properties, origin }: Props) {
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const payload = buildCityJsonLd(city, properties, origin);
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.setAttribute(SCRIPT_ATTR, '');
    script.textContent = JSON.stringify(payload);
    document.head.appendChild(script);

    return () => {
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    };
  }, [city, properties, origin]);

  return null;
}

/** Re-export so callers can map the route param without importing fixtures twice. */
export { GPMG_FIXTURES };
