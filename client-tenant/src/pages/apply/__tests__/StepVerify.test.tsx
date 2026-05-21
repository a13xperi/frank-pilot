import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { StepVerify } from '../steps/StepVerify';
import { renderWithApply, makeState, mockFetch } from './helpers';

describe('StepVerify', () => {
  it('shows the check-your-email screen with the email address', () => {
    mockFetch({});
    const state = makeState({ step: 'verify', email: 'marisol@example.com' });
    renderWithApply(<StepVerify />, { state });
    expect(screen.getByRole('heading', { name: /check your email/i })).toBeInTheDocument();
    expect(screen.getByText(/marisol@example\.com/)).toBeInTheDocument();
  });
});
