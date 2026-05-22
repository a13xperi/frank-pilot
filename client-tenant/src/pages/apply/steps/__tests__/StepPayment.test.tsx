// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import axe from 'axe-core';
import { StepPayment } from '../StepPayment';
import { ApplyProvider } from '@/pages/apply/context/ApplyContext';

const navigateSpy = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateSpy };
});

function renderWithProviders() {
  return render(
    <MemoryRouter initialEntries={[`/apply?step=payment`]}>
      <ApplyProvider>
        <Routes>
          <Route path="/apply" element={<StepPayment />} />
        </Routes>
      </ApplyProvider>
    </MemoryRouter>,
  );
}

function fillForm() {
  const inputs = screen.getAllByRole('textbox') as HTMLInputElement[];
  for (const input of inputs) fireEvent.change(input, { target: { value: '4242' } });
}

describe('StepPayment — beacons fire on submit', () => {
  beforeEach(() => {
    navigateSpy.mockReset();
    sessionStorage.clear();
  });

  it('fires payment_initiated then payment_succeeded with correct payload, navigates to ?step=2', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch' as never)
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response);

    renderWithProviders();
    fillForm();

    const submit = screen.getByRole('button', { name: /pay \$/i });
    fireEvent.click(submit);

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));

    const [initCall, successCall] = fetchSpy.mock.calls as unknown as Array<[string, RequestInit]>;
    // VITE_API_BASE_URL may be set in test env — assert path suffix, not full URL.
    expect(initCall[0]).toMatch(/\/api\/tape\/payment-init$/);
    expect(successCall[0]).toMatch(/\/api\/tape\/payment-success$/);

    const initBody = JSON.parse(String(initCall[1].body));
    expect(initBody).toMatchObject({ adults: 1, total: '71.90' });
    expect(typeof initBody.session_id).toBe('string');

    const successBody = JSON.parse(String(successCall[1].body));
    expect(successBody.adults).toBe(1);
    expect(successBody.total).toBe('71.90');
    expect(typeof successBody.paymentRef).toBe('string');
    expect(successBody.paymentRef).toMatch(/^pay_/);

    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith('?step=2'));
  });

  it('shows retry on 5xx', async () => {
    vi.spyOn(globalThis, 'fetch' as never).mockResolvedValue({
      ok: false, status: 500, json: async () => ({}),
    } as Response);

    renderWithProviders();
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: /pay \$/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });
});

describe('StepPayment — a11y', () => {
  beforeEach(() => sessionStorage.clear());
  it('has no axe violations', async () => {
    vi.spyOn(globalThis, 'fetch' as never).mockResolvedValue({ ok: true, status: 200 } as Response);
    const { container } = renderWithProviders();
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });
});
