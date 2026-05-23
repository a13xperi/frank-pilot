import { describe, it, expect } from 'vitest';
import {
  AMI_TABLES,
  formatAmiTier,
  qualifyAmiTier,
  qualifyingTiers,
} from '../ami';

const MSA = 'LAS_VEGAS_HENDERSON' as const;

describe('qualifyAmiTier', () => {
  it('returns null for over-income applicants (above 80% AMI cap)', () => {
    expect(qualifyAmiTier(MSA, 4, 100_000)).toBeNull();
  });

  it('returns "30" for applicants at or below the 30% cap', () => {
    const cap30 = AMI_TABLES[MSA].limits[4]['30'];
    expect(qualifyAmiTier(MSA, 4, cap30)).toBe('30');
    expect(qualifyAmiTier(MSA, 4, cap30 - 1000)).toBe('30');
  });

  it('returns "50" for applicants between 30% and 50% caps', () => {
    const cap30 = AMI_TABLES[MSA].limits[4]['30'];
    const cap50 = AMI_TABLES[MSA].limits[4]['50'];
    expect(qualifyAmiTier(MSA, 4, cap30 + 1)).toBe('50');
    expect(qualifyAmiTier(MSA, 4, cap50)).toBe('50');
  });

  it('returns "60" for applicants between 50% and 60% caps', () => {
    const cap50 = AMI_TABLES[MSA].limits[4]['50'];
    const cap60 = AMI_TABLES[MSA].limits[4]['60'];
    expect(qualifyAmiTier(MSA, 4, cap50 + 1)).toBe('60');
    expect(qualifyAmiTier(MSA, 4, cap60)).toBe('60');
  });

  it('returns "80" for applicants between 60% and 80% caps', () => {
    const cap60 = AMI_TABLES[MSA].limits[4]['60'];
    const cap80 = AMI_TABLES[MSA].limits[4]['80'];
    expect(qualifyAmiTier(MSA, 4, cap60 + 1)).toBe('80');
    expect(qualifyAmiTier(MSA, 4, cap80)).toBe('80');
  });

  it('clamps household size 0 to 1', () => {
    const cap50size1 = AMI_TABLES[MSA].limits[1]['50'];
    expect(qualifyAmiTier(MSA, 0, cap50size1)).toBe('50');
  });

  it('clamps household size above 12 to 12', () => {
    const cap50size12 = AMI_TABLES[MSA].limits[12]['50'];
    expect(qualifyAmiTier(MSA, 20, cap50size12)).toBe('50');
  });

  it('rejects negative income', () => {
    expect(qualifyAmiTier(MSA, 4, -100)).toBeNull();
  });

  it('rejects NaN income', () => {
    expect(qualifyAmiTier(MSA, 4, Number.NaN)).toBeNull();
  });

  it('floors fractional household sizes', () => {
    const cap50size4 = AMI_TABLES[MSA].limits[4]['50'];
    expect(qualifyAmiTier(MSA, 4.7, cap50size4)).toBe('50');
  });
});

describe('qualifyingTiers', () => {
  it('returns all tiers from min upward', () => {
    expect(qualifyingTiers('30')).toEqual(['30', '50', '60', '80']);
    expect(qualifyingTiers('50')).toEqual(['50', '60', '80']);
    expect(qualifyingTiers('60')).toEqual(['60', '80']);
    expect(qualifyingTiers('80')).toEqual(['80']);
  });

  it('returns empty for null', () => {
    expect(qualifyingTiers(null)).toEqual([]);
  });
});

describe('formatAmiTier', () => {
  it('formats tiers as percent labels', () => {
    expect(formatAmiTier('30')).toBe('30% AMI');
    expect(formatAmiTier('50')).toBe('50% AMI');
    expect(formatAmiTier('60')).toBe('60% AMI');
    expect(formatAmiTier('80')).toBe('80% AMI');
  });

  it('formats null as over-income message', () => {
    expect(formatAmiTier(null)).toBe('Over income for affordable tiers');
  });
});
