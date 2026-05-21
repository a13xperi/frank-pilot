import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { StepIntent } from '../steps/StepIntent';
import { renderWithApply, makeState, mockFetch } from './helpers';

describe('StepIntent', () => {
  it('renders the intent quiz', () => {
    mockFetch({});
    renderWithApply(<StepIntent />, { state: makeState({ step: 'intent' }) });
    expect(screen.getByRole('heading', { name: /what are you looking for/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/target move-in/i)).toBeInTheDocument();
  });

  it('prefills bedrooms + propertyId from ?unitType=2BR&propertyId=donna-louise-2', async () => {
    mockFetch({});
    const setIntentBedrooms = vi.fn();
    const setPropertyId = vi.fn();
    const state = makeState({
      step: 'intent',
      setIntentBedrooms,
      setPropertyId,
    });
    renderWithApply(<StepIntent />, {
      state,
      route: '/apply?step=intent&unitType=2BR&propertyId=donna-louise-2',
    });
    await waitFor(() => {
      expect(setIntentBedrooms).toHaveBeenCalledWith(2);
      expect(setPropertyId).toHaveBeenCalledWith('donna-louise-2');
    });
  });

  it('maps STUDIO → 0 bedrooms', async () => {
    mockFetch({});
    const setIntentBedrooms = vi.fn();
    const state = makeState({ step: 'intent', setIntentBedrooms });
    renderWithApply(<StepIntent />, {
      state,
      route: '/apply?step=intent&unitType=STUDIO',
    });
    await waitFor(() => {
      expect(setIntentBedrooms).toHaveBeenCalledWith(0);
    });
  });
});
