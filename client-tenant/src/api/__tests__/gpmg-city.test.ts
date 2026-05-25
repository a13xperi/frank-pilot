import { describe, expect, it } from 'vitest';
import {
  GPMG_FIXTURES,
  GPMG_CITIES,
  citySlug,
  findCityBySlug,
  propertiesInCity,
  slugify,
} from '../gpmg-fixtures';

describe('GPMG city helpers', () => {
  it('derives one entry per distinct fixture city', () => {
    const distinct = new Set(GPMG_FIXTURES.map((p) => p.city));
    expect(GPMG_CITIES.length).toBe(distinct.size);
    for (const c of GPMG_CITIES) {
      expect(distinct.has(c.name)).toBe(true);
    }
  });

  it('counts add up to the full fixture set (every property lands in a city)', () => {
    const total = GPMG_CITIES.reduce((sum, c) => sum + c.count, 0);
    expect(total).toBe(GPMG_FIXTURES.length);
  });

  it('each city count matches its actual fixture membership', () => {
    for (const c of GPMG_CITIES) {
      expect(c.count).toBe(propertiesInCity(c.name).length);
    }
  });

  it('sorts by count desc then name asc (Las Vegas leads)', () => {
    for (let i = 1; i < GPMG_CITIES.length; i++) {
      const prev = GPMG_CITIES[i - 1]!;
      const cur = GPMG_CITIES[i]!;
      expect(
        prev.count > cur.count ||
          (prev.count === cur.count && prev.name <= cur.name),
      ).toBe(true);
    }
    // Today's catalog: Las Vegas has the most inventory.
    expect(GPMG_CITIES[0]!.name).toBe('Las Vegas');
  });

  it('citySlug matches slugify (kebab-case, no trailing dashes)', () => {
    expect(citySlug('North Las Vegas')).toBe('north-las-vegas');
    expect(citySlug('Las Vegas')).toBe(slugify('Las Vegas'));
  });

  it('findCityBySlug round-trips every city slug to its canonical entry', () => {
    for (const c of GPMG_CITIES) {
      const hit = findCityBySlug(c.slug);
      expect(hit).toBeDefined();
      expect(hit!.name).toBe(c.name);
    }
  });

  it('findCityBySlug returns undefined for an unknown slug', () => {
    expect(findCityBySlug('reno')).toBeUndefined();
    expect(findCityBySlug('')).toBeUndefined();
    expect(findCityBySlug('not-a-city')).toBeUndefined();
  });

  it('propertiesInCity returns only fixtures for that exact city', () => {
    const lv = propertiesInCity('Las Vegas');
    expect(lv.length).toBeGreaterThan(0);
    expect(lv.every((p) => p.city === 'Las Vegas')).toBe(true);
    expect(propertiesInCity('Nowhere')).toEqual([]);
  });
});
