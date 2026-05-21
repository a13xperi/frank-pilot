import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { StepClaim } from '../steps/StepClaim';
import { renderWithApply, makeState, mockFetch } from './helpers';
import type { Unit } from '@/api/units';

const unit: Unit = {
  id: 'unit-1234abcd',
  property_id: 'donna-louise-2',
  unit_number: '204',
  bedrooms: 2,
  bathrooms: '1',
  sqft: 800,
  monthly_rent: '1500',
  photo_url: null,
  available_from: null,
  property_name: 'Donna Louise II',
  property_city: 'Reno',
  property_state: 'NV',
};

describe('StepClaim', () => {
  it('renders the claimed-unit confirmation', () => {
    mockFetch({});
    const state = makeState({
      step: 'claim',
      claimedUnit: unit,
      claimExpiresAt: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
    });
    renderWithApply(<StepClaim />, { state });
    expect(screen.getByRole('heading', { name: /unit 204 is yours/i })).toBeInTheDocument();
    expect(screen.getByText(/donna louise ii/i)).toBeInTheDocument();
  });

  it('falls back to start-over when no claim exists', () => {
    mockFetch({});
    renderWithApply(<StepClaim />, { state: makeState({ step: 'claim' }) });
    expect(screen.getByText(/no active claim/i)).toBeInTheDocument();
  });
});
