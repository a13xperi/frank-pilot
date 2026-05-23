import { describe, it, expect } from 'vitest';
import { cityToCountyKey } from '../nv-counties';

describe('cityToCountyKey', () => {
  it('maps the GPMG catalog cities to CLARK', () => {
    expect(cityToCountyKey('Las Vegas')).toBe('CLARK');
    expect(cityToCountyKey('North Las Vegas')).toBe('CLARK');
    expect(cityToCountyKey('Henderson')).toBe('CLARK');
  });

  it('maps other Clark County municipalities to CLARK', () => {
    expect(cityToCountyKey('Boulder City')).toBe('CLARK');
    expect(cityToCountyKey('Mesquite')).toBe('CLARK');
    expect(cityToCountyKey('Laughlin')).toBe('CLARK');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(cityToCountyKey('  las vegas  ')).toBe('CLARK');
    expect(cityToCountyKey('HENDERSON')).toBe('CLARK');
  });

  it('returns null for not-yet-ingested counties (→ "coming soon")', () => {
    expect(cityToCountyKey('Reno')).toBeNull(); // Washoe
    expect(cityToCountyKey('Carson City')).toBeNull();
    expect(cityToCountyKey('Elko')).toBeNull();
  });

  it('returns null for empty / missing input', () => {
    expect(cityToCountyKey('')).toBeNull();
    expect(cityToCountyKey(null)).toBeNull();
    expect(cityToCountyKey(undefined)).toBeNull();
  });
});
