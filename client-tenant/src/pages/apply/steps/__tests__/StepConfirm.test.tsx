// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import axe from 'axe-core';
import { StepConfirm } from '../StepConfirm';
import { ApplyProvider } from '@/pages/apply/context/ApplyContext';

function renderConfirm(opts?: { withRef?: boolean; position?: number | null }) {
  if (opts?.withRef) {
    sessionStorage.setItem(
      'frank_apply_state',
      JSON.stringify({ adults: 1, paymentTotal: '35.95', paymentRef: 'pay_test_abc123' }),
    );
  }
  return render(
    <MemoryRouter>
      <ApplyProvider>
        <StepConfirm waitlist={opts?.position != null ? { position: opts.position } : null} />
      </ApplyProvider>
    </MemoryRouter>,
  );
}

describe('StepConfirm', () => {
  beforeEach(() => sessionStorage.clear());

  it('renders paymentRef when set', () => {
    renderConfirm({ withRef: true });
    expect(screen.getByTestId('payment-ref')).toHaveTextContent('pay_test_abc123');
  });

  it('shows fallback when paymentRef missing', () => {
    renderConfirm();
    expect(screen.getByTestId('payment-ref')).toHaveTextContent('—');
  });

  it('shows numeric queue position when waitlist summary provided', () => {
    renderConfirm({ withRef: true, position: 12 });
    expect(screen.getByText('#12')).toBeInTheDocument();
  });

  it('falls back to "position confirmed" when no waitlist summary', () => {
    renderConfirm({ withRef: true });
    expect(screen.getByText(/position confirmed/i)).toBeInTheDocument();
  });

  it('links to /dashboard', () => {
    renderConfirm({ withRef: true });
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/dashboard');
  });

  it('has no axe violations', async () => {
    const { container } = renderConfirm({ withRef: true });
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });
});
