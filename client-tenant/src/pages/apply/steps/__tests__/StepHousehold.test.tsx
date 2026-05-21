// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useSearchParams } from 'react-router-dom';
import axe from 'axe-core';
import { ApplyProvider, useApply } from '../../ApplyContext';
import { StepReview } from '../StepReview';
import { StepHousehold } from '../StepHousehold';

function StepProbe() {
  const [search] = useSearchParams();
  const { state } = useApply();
  return (
    <div>
      <div data-testid="step-probe">{search.get('step') ?? 'review'}</div>
      <div data-testid="state-adults">{state.adults}</div>
      <div data-testid="state-total">{state.paymentTotal}</div>
    </div>
  );
}

function App() {
  const [search] = useSearchParams();
  const step = search.get('step') ?? 'review';
  return (
    <>
      {step === 'review' && <StepReview />}
      {step === 'household' && <StepHousehold />}
      {step === 'payment' && <div>PAYMENT STEP</div>}
      <StepProbe />
    </>
  );
}

function renderApp(initialStep = 'review') {
  return render(
    <MemoryRouter initialEntries={[`/apply?step=${initialStep}`]}>
      <ApplyProvider initialState={{
        property: { id: 'p1', name: 'Donna Louise 2', address: '2241 Sunrise' },
        unit: { type: '2BR', bedrooms: 2, sqft: 820, waitlistPosition: null },
        criteria: { incomeBand: '50–60% AMI', householdSize: 2, moveInDate: '2026-08-01' },
      }}>
        <Routes>
          <Route path="/apply" element={<App />} />
        </Routes>
      </ApplyProvider>
    </MemoryRouter>,
  );
}

describe('StepHousehold', () => {
  it('defaults to 1 adult → total $71.90 (1 applicant + 1 self = (1+1) × 35.95)', () => {
    renderApp('household');
    expect(screen.getByTestId('adults-count').textContent).toBe('1');
    expect(screen.getByTestId('payment-total').textContent).toBe('$71.90');
  });

  it('+ increments adults, fee total updates from context', () => {
    renderApp('household');
    const inc = screen.getByRole('button', { name: /add adult/i });
    fireEvent.click(inc);
    fireEvent.click(inc);
    expect(screen.getByTestId('adults-count').textContent).toBe('3');
    expect(screen.getByTestId('payment-total').textContent).toBe('$143.80');
  });

  it('− decrements but floors at 1', () => {
    renderApp('household');
    const dec = screen.getByRole('button', { name: /remove adult/i });
    fireEvent.click(dec);
    fireEvent.click(dec);
    expect(screen.getByTestId('adults-count').textContent).toBe('1');
  });

  it('has no axe-core a11y violations', async () => {
    const { container } = renderApp('household');
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });
});

describe('Integration: review → household → payment', () => {
  it('walks the flow, sets adults=3, asserts paymentTotal=$143.80', () => {
    renderApp('review');

    // Step 1: Review → Continue → household
    fireEvent.click(screen.getByRole('button', { name: /yes, continue/i }));
    expect(screen.getByTestId('step-probe').textContent).toBe('household');

    // Step 2: bump adults to 3
    const inc = screen.getByRole('button', { name: /add adult/i });
    fireEvent.click(inc);
    fireEvent.click(inc);

    expect(screen.getByTestId('state-adults').textContent).toBe('3');
    expect(screen.getByTestId('state-total').textContent).toBe('$143.80');

    // Step 3: continue → payment
    fireEvent.click(screen.getByRole('button', { name: /continue to payment/i }));
    expect(screen.getByTestId('step-probe').textContent).toBe('payment');
    expect(screen.getByText(/PAYMENT STEP/)).toBeInTheDocument();
  });
});
