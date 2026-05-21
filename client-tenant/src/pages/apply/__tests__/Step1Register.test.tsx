import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { Step1Register } from '../steps/Step1Register';
import { renderWithApply, mockFetch } from './helpers';

describe('Step1Register', () => {
  it('renders the register form', () => {
    mockFetch({});
    renderWithApply(<Step1Register />);
    expect(screen.getByRole('heading', { name: /create your account/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/first name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
  });
});
