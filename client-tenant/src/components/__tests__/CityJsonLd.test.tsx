// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { CityJsonLd, buildCityJsonLd } from '../CityJsonLd';
import { propertiesInCity, slugify } from '@/api/gpmg-fixtures';

const ORIGIN = 'https://frank-pilot-tenant.vercel.app';
const CITY = 'Las Vegas';
const PROPS = propertiesInCity(CITY);

describe('CityJsonLd', () => {
  beforeEach(() => {
    document
      .querySelectorAll('script[type="application/ld+json"]')
      .forEach((n) => n.remove());
  });

  it('injects a single ld+json CollectionPage into <head>', () => {
    render(<CityJsonLd city={CITY} properties={PROPS} origin={ORIGIN} />);
    const scripts = document.head.querySelectorAll(
      'script[type="application/ld+json"]',
    );
    expect(scripts.length).toBe(1);
    const parsed = JSON.parse(scripts[0]!.textContent || '{}');
    expect(parsed['@context']).toBe('https://schema.org');
    expect(parsed['@type']).toBe('CollectionPage');
  });

  it('removes the script on unmount', () => {
    const { unmount } = render(
      <CityJsonLd city={CITY} properties={PROPS} origin={ORIGIN} />,
    );
    expect(
      document.head.querySelectorAll('script[type="application/ld+json"]').length,
    ).toBe(1);
    unmount();
    expect(
      document.head.querySelectorAll('script[type="application/ld+json"]').length,
    ).toBe(0);
  });

  it('builds an ItemList with one ListItem per property pointing at /property/{slug}', () => {
    const payload = buildCityJsonLd(CITY, PROPS, ORIGIN);
    const list = payload.mainEntity as Record<string, unknown>;
    expect(list['@type']).toBe('ItemList');
    expect(list.numberOfItems).toBe(PROPS.length);

    const items = list.itemListElement as Array<Record<string, unknown>>;
    expect(items.length).toBe(PROPS.length);
    items.forEach((item, i) => {
      expect(item['@type']).toBe('ListItem');
      expect(item.position).toBe(i + 1);
      expect(item.name).toBe(PROPS[i]!.name);
      expect(item.url).toBe(`${ORIGIN}/property/${slugify(PROPS[i]!.name)}`);
    });
  });

  it('scopes the about.address to the city in Nevada', () => {
    const payload = buildCityJsonLd(CITY, PROPS, ORIGIN);
    const about = payload.about as Record<string, unknown>;
    const address = about.address as Record<string, unknown>;
    expect(address.addressLocality).toBe(CITY);
    expect(address.addressRegion).toBe('NV');
    expect(address.addressCountry).toBe('US');
  });
});
