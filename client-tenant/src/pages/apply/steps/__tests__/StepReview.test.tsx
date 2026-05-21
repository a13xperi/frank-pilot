// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useSearchParams } from 'react-router-dom';
import axe from 'axe-core';
import { StepReview } from '../StepReview';
import { WizardTestProvider } from './wizardTestUtils';

function StepProbe() {
  const [search] = useSearchParams();
  return <div data-testid="step-probe">{search.get('step') ?? 'review'}</div>;
}

function renderAt() {
  return render(
    <MemoryRouter initialEntries={['/apply?step=review']}>
      <WizardTestProvider seed={{
        claimedUnit: { property_name: 'Donna Louise 2', property_city: '', property_state: '', bedrooms: 2, sqft: 820 },
        intentBedrooms: 2,
        intentHouseholdSize: 2,
        intentMoveInDate: '2026-08-01',
      }}>
        <Routes>
          <Route path="/apply" element={<><StepReview /><StepProbe /></>} />
        </Routes>
      </WizardTestProvider>
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
