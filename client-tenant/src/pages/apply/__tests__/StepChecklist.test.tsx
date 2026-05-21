import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StepChecklist } from '../steps/StepChecklist';
import { renderWithApply, makeState, mockFetch } from './helpers';

describe('StepChecklist', () => {
  it('renders 5 required-doc items + fee + 120-day rule', () => {
    mockFetch({});
    renderWithApply(<StepChecklist />, { state: makeState({ step: 'checklist' }) });
    expect(screen.getByRole('heading', { name: /before you apply/i })).toBeInTheDocument();
    expect(screen.getByText(/photo ID/i)).toBeInTheDocument();
    expect(screen.getByText(/proof of income/i)).toBeInTheDocument();
    expect(screen.getByText(/social security number/i)).toBeInTheDocument();
    expect(screen.getByText(/landlord references/i)).toBeInTheDocument();
    expect(screen.getByText(/household composition/i)).toBeInTheDocument();
    expect(screen.getByText(/\$35\.95/)).toBeInTheDocument();
    expect(screen.getByText(/120 days/i)).toBeInTheDocument();
  });

  it('advances to pick on continue', async () => {
    mockFetch({});
    const setStep = vi.fn();
    const state = makeState({ step: 'checklist', setStep });
    renderWithApply(<StepChecklist />, { state });
    await userEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(setStep).toHaveBeenCalledWith('pick');
  });
});
