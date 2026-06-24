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

  // Deep-link scoping: arriving via frank-go /dl2 seeds propertySlug, and the
  // picker must scope to that building so it isn't buried under the
  // portfolio-wide ORDER BY rent LIMIT 12.
  it('scopes the picker fetch to the arrived-for property when propertySlug is set', async () => {
    const fetchMock = mockFetch({ '/applicants/units': { units: [] } });
    const state = makeState({
      step: 'pick',
      intentBedrooms: 2,
      intentMoveInDate: '2026-06-01',
      intentBudgetMax: 2000,
      propertySlug: 'donna-louise-2',
    });
    renderWithApply(<StepPick />, { state });
    await waitFor(() => {
      const unitCalls = fetchMock.mock.calls
        .map((c) => String(c[0]))
        .filter((u) => u.includes('/applicants/units'));
      expect(unitCalls.length).toBeGreaterThan(0);
      // The strict (first) stage carries the property scope.
      expect(unitCalls[0]).toContain('propertyId=donna-louise-2');
    });
  });

  it('does not scope the picker for a portfolio walk-in (no slug, no id)', async () => {
    const fetchMock = mockFetch({ '/applicants/units': { units: [] } });
    const state = makeState({
      step: 'pick',
      intentBedrooms: 2,
      intentMoveInDate: '2026-06-01',
      intentBudgetMax: 2000,
    });
    renderWithApply(<StepPick />, { state });
    await waitFor(() => {
      const unitCalls = fetchMock.mock.calls
        .map((c) => String(c[0]))
        .filter((u) => u.includes('/applicants/units'));
      expect(unitCalls.length).toBeGreaterThan(0);
      expect(unitCalls.some((u) => u.includes('propertyId='))).toBe(false);
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
