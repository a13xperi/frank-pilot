import { describe, it, expect } from 'vitest';
import {
  nameWord,
  placeholderFor,
  getUnitPhoto,
  isPlaceholder,
  UNIT_PLACEHOLDER,
} from '../unitPlaceholder';

/** Decode a `data:image/svg+xml,...` URI back to its SVG source. */
function svgOf(dataUri: string): string {
  const comma = dataUri.indexOf(',');
  return decodeURIComponent(dataUri.slice(comma + 1));
}

describe('nameWord', () => {
  it('picks the distinctive proper noun, stripping generic words', () => {
    expect(nameWord('David J. Hoggard Family Community')).toBe('HOGGARD');
    expect(nameWord('Owens Senior Housing')).toBe('OWENS');
    expect(nameWord('Donna Louise 2')).toBe('LOUISE');
  });

  it('returns empty string for no usable label', () => {
    expect(nameWord('')).toBe('');
    expect(nameWord(null)).toBe('');
    expect(nameWord('2')).toBe('');
  });

  it('clamps to 10 characters', () => {
    expect(nameWord('Sunnyvalemeadowsbrook').length).toBeLessThanOrEqual(10);
  });
});

describe('placeholderFor', () => {
  it('returns a decodable data:image/svg+xml URI containing an <svg>', () => {
    const uri = placeholderFor('owens-senior-housing', 'Owens Senior Housing');
    expect(uri.startsWith('data:image/svg+xml,')).toBe(true);
    expect(svgOf(uri)).toContain('<svg');
  });

  it('is deterministic — same seed yields the identical URI', () => {
    const a = placeholderFor('owens-senior-housing', 'Owens Senior Housing');
    const b = placeholderFor('owens-senior-housing', 'Owens Senior Housing');
    expect(a).toBe(b);
  });

  it('varies the gradient across different seeds', () => {
    const a = placeholderFor('aaa');
    const b = placeholderFor('zzz-different-seed');
    expect(a).not.toBe(b);
  });

  it('renders the name word when a label is given', () => {
    const svg = svgOf(placeholderFor('x', 'David J. Hoggard Family Community'));
    expect(svg).toContain('<text');
    expect(svg).toContain('HOGGARD');
  });

  it('is glyph-only (no <text>) when no label is given', () => {
    const svg = svgOf(placeholderFor('some-unit-uuid'));
    expect(svg).not.toContain('<text');
  });

  it('never emits an unescaped paren in the URI (CSS url() safety)', () => {
    const uri = placeholderFor('weird', 'The (Old) Mill Apartments');
    expect(uri.includes('(')).toBe(false);
    expect(uri.includes(')')).toBe(false);
  });
});

describe('getUnitPhoto', () => {
  it('prefers a real photo URL when present', () => {
    expect(getUnitPhoto('/uploads/real.jpg', 'seed')).toBe('/uploads/real.jpg');
  });

  it('falls back to a generated placeholder otherwise', () => {
    expect(getUnitPhoto(null, 'seed').startsWith('data:image/svg+xml,')).toBe(true);
  });
});

describe('isPlaceholder', () => {
  it('recognises generated data-URIs', () => {
    expect(isPlaceholder(placeholderFor('s', 'Owens'))).toBe(true);
    expect(isPlaceholder(UNIT_PLACEHOLDER)).toBe(true);
  });

  it('still recognises legacy asset paths (static map / OG back-compat)', () => {
    expect(isPlaceholder('/property-placeholders/building-01.jpg')).toBe(true);
    expect(isPlaceholder('/unit-placeholder.svg')).toBe(true);
  });

  it('treats null/empty as a placeholder and real uploads as not', () => {
    expect(isPlaceholder(null)).toBe(true);
    expect(isPlaceholder('')).toBe(true);
    expect(isPlaceholder('/uploads/real.jpg')).toBe(false);
  });
});
