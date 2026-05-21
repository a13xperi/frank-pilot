// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useSearchParams } from 'react-router-dom';
import axe from 'axe-core';
import { ApplyProvider } from '../../ApplyContext';
import { StepReview } from '../StepReview';

function StepProbe() {
  const [search] = useSearchParams();
  return <div data-testid="step-probe">{search.get('step') ?? 'review'}</div>;
}

function renderAt() {
  return render(
    <MemoryRouter initialEntries={['/apply?step=review']}>
      <ApplyProvider initialState={{
        property: { id: 'p1', name: 'Donna Louise 2', photoUrl: '', address: '2241 Sunrise Ave' },
        unit: { type: '2BR', bedrooms: 2, sqft: 820, waitlistPosition: null },
        criteria: { incomeBand: '50–60% AMI', householdSize: 2, moveInDate: '2026-08-01' },
      }}>
        <Routes>
          <Route path="/apply" element={<><StepReview /><StepProbe /></>} />
        </Routes>
      </ApplyProvider>
    </MemoryRouter>,
  );
}

describe('StepReview', () => {
  it('renders boarding-pass recap with property + locked criteria', () => {
    renderAt();
    expect(screen.getByText(/Confirm what you're applying for/i)).toBeInTheDocument();
    expect(screen.getByText(/Donna Louise 2/i)).toBeInTheDocument();
    expect(screen.getByText(/50–60% AMI/)).toBeInTheDocument();
  });

  it('Continue advances to household via ?step=household', () => {
    renderAt();
    const cta = screen.getByRole('button', { name: /yes, continue/i });
    fireEvent.click(cta);
    expect(screen.getByTestId('step-probe').textContent).toBe('household');
  });

  it('edit links route to ?step=intent', () => {
    renderAt();
    const editBtns = screen.getAllByRole('button', { name: /edit/i });
    fireEvent.click(editBtns[0]);
    expect(screen.getByTestId('step-probe').textContent).toBe('intent');
  });

  it('has no axe-core a11y violations', async () => {
    const { container } = renderAt();
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });
});
