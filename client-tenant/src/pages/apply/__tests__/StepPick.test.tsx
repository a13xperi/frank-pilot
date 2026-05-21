import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { StepPick } from '../steps/StepPick';
import { renderWithApply, makeState, mockFetch } from './helpers';

describe('StepPick', () => {
  it('renders the title and a loading state when units fetch is in flight', async () => {
    mockFetch({
      '/applicants/units': { units: [] },
    });
    const state = makeState({
      step: 'pick',
      intentBedrooms: 2,
      intentMoveInDate: '2026-06-01',
      intentBudgetMax: 2000,
    });
    renderWithApply(<StepPick />, { state });
    expect(screen.getByRole('heading', { name: /pick your unit/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText(/loading units/i)).not.toBeInTheDocument();
    });
  });
});
