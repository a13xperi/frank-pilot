import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { StepPick } from '../steps/StepPick';
import { renderWithApply, makeState, mockFetch } from './helpers';

vi.mock('@/api/properties', () => ({
  joinWaitlist: vi.fn(),
}));

import * as propertiesApi from '@/api/properties';

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

  it('shows waitlist CTA when zero units, joinWaitlist call sets outcome', async () => {
    mockFetch({
      '/applicants/units': { units: [] },
    });
    vi.mocked(propertiesApi.joinWaitlist).mockResolvedValue({
      position: 5,
      totalQueue: 50,
      movement: null,
      estimatedWindow: '3–6 months',
      expectedNotificationWindow: '3–6 months',
      enrolled: true,
    });

    const setOutcome = vi.fn();
    const setPropertySlug = vi.fn();
    const setStep = vi.fn();

    const state = makeState({
      step: 'pick',
      intentBedrooms: 2,
      intentMoveInDate: '2026-06-01',
      intentBudgetMax: 2000,
      propertySlug: 'donna-louise-2',
      setOutcome,
      setPropertySlug,
      setStep,
    });

    renderWithApply(<StepPick />, { state });

    await waitFor(() => {
      expect(screen.getByTestId('join-waitlist-cta')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('join-waitlist-cta'));

    await waitFor(() => {
      expect(propertiesApi.joinWaitlist).toHaveBeenCalledWith('donna-louise-2', 2);
      expect(setPropertySlug).toHaveBeenCalledWith('donna-louise-2');
      expect(setOutcome).toHaveBeenCalledWith('waitlisted');
      expect(setStep).toHaveBeenCalledWith('confirm');
    });
  });
});
