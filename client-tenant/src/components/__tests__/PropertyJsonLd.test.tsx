// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { PropertyJsonLd, buildPropertyJsonLd } from '../PropertyJsonLd';
import { GPMG_FIXTURES } from '@/api/gpmg-fixtures';

const SAMPLE = GPMG_FIXTURES[0]!; // Aldene Kline Barlow Senior Apartments

describe('PropertyJsonLd', () => {
  beforeEach(() => {
    // Strip any leftover ld+json scripts between tests.
    document
      .querySelectorAll('script[type="application/ld+json"]')
      .forEach((n) => n.remove());
  });

  it('injects a single <script type="application/ld+json"> into <head>', () => {
    render(<PropertyJsonLd property={SAMPLE} />);

    const scripts = document.head.querySelectorAll(
      'script[type="application/ld+json"]'
    );
    expect(scripts.length).toBe(1);
  });

  it('emits a parseable payload tagged as schema.org/Apartment with the property name', () => {
    render(<PropertyJsonLd property={SAMPLE} />);

    const script = document.head.querySelector(
      'script[type="application/ld+json"]'
    )!;
    const parsed = JSON.parse(script.textContent || '{}');
    expect(parsed['@context']).toBe('https://schema.org');
    expect(parsed['@type']).toBe('Apartment');
    expect(parsed.name).toBe(SAMPLE.name);
  });

  it('emits a PostalAddress populated from the fixture row', () => {
    render(<PropertyJsonLd property={SAMPLE} />);

    const script = document.head.querySelector(
      'script[type="application/ld+json"]'
    )!;
    const parsed = JSON.parse(script.textContent || '{}');
    expect(parsed.address['@type']).toBe('PostalAddress');
    expect(parsed.address.streetAddress).toBe(SAMPLE.addr);
    expect(parsed.address.addressLocality).toBe(SAMPLE.city);
    expect(parsed.address.addressRegion).toBe('NV');
    expect(parsed.address.postalCode).toBe(SAMPLE.zip);
    expect(parsed.address.addressCountry).toBe('US');
  });

  it('emits offers with one UnitPriceSpecification per populated bedroom bucket', () => {
    // Aldene Kline Barlow has Studio + 1BR in the rent schedule.
    render(<PropertyJsonLd property={SAMPLE} />);

    const script = document.head.querySelector(
      'script[type="application/ld+json"]'
    )!;
    const parsed = JSON.parse(script.textContent || '{}');
    expect(parsed.offers['@type']).toBe('Offer');
    expect(parsed.offers.priceCurrency).toBe('USD');
    expect(parsed.offers.availability).toBe('https://schema.org/InStock');
    expect(Array.isArray(parsed.offers.priceSpecification)).toBe(true);
    expect(parsed.offers.priceSpecification.length).toBeGreaterThan(0);

    const specs = parsed.offers.priceSpecification;
    specs.forEach((s: Record<string, unknown>) => {
      expect(s['@type']).toBe('UnitPriceSpecification');
      expect(s.priceCurrency).toBe('USD');
      expect(s.unitText).toBe('MONTHLY');
      expect(typeof s.price).toBe('number');
      expect(typeof s.name).toBe('string');
    });

    // Studio = $747 (from utils/pricing.ts) — sanity anchor.
    const studio = specs.find((s: Record<string, unknown>) => s.name === 'Studio');
    expect(studio).toBeTruthy();
    expect(studio?.price).toBe(747);
  });

  it('removes the script from <head> on unmount', () => {
    const { unmount } = render(<PropertyJsonLd property={SAMPLE} />);
    expect(
      document.head.querySelectorAll('script[type="application/ld+json"]').length
    ).toBe(1);
    unmount();
    expect(
      document.head.querySelectorAll('script[type="application/ld+json"]').length
    ).toBe(0);
  });

  it('buildPropertyJsonLd omits offers when the property has no rent schedule', () => {
    const offCatalog = {
      name: 'Not A Real Property',
      addr: '1 Nowhere Ln',
      city: 'Las Vegas' as const,
      zip: '89000',
      phone: '(000) 000-0000',
      email: null,
      units: null,
      type: 'family' as const,
    };
    const payload = buildPropertyJsonLd(offCatalog);
    expect(payload.offers).toBeUndefined();
    expect(payload.name).toBe('Not A Real Property');
  });
});
