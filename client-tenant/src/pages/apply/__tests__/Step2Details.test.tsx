import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { Step2Details } from '../steps/Step2Details';
import { renderWithApply, makeState, mockFetch } from './helpers';
import type { Unit } from '@/api/units';

const claimedUnit: Unit = {
  id: 'u', property_id: 'p', unit_number: '101', bedrooms: 1, bathrooms: '1',
  sqft: 600, monthly_rent: '1200', photo_url: null, available_from: null,
  property_name: 'X', property_city: null, property_state: null,
};

describe('Step2Details', () => {
  it('renders the details form with SSN + DOB when a unit is claimed', () => {
    mockFetch({});
    const state = makeState({ step: 2, claimedUnit });
    renderWithApply(<Step2Details />, { state });
    expect(screen.getByRole('heading', { name: /application details/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/social security number/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/date of birth/i)).toBeInTheDocument();
  });
});
