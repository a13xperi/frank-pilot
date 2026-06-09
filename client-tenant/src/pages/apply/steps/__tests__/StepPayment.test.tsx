// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import axe from 'axe-core';
import { StepPayment } from '../StepPayment';
import { TestApplyProvider } from './applyTestUtils';

const navigateSpy = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateSpy };
});

function renderWithProviders(adults = 1) {
  return render(
    <MemoryRouter initialEntries={[`/apply?step=payment`]}>
      <TestApplyProvider adults={adults}>
        <Routes>
          <Route path="/apply" element={<StepPayment />} />
        </Routes>
      </TestApplyProvider>
    </MemoryRouter>,
  );
}

function fillForm() {
  const inputs = screen.getAllByRole('textbox') as HTMLInputElement[];
  for (const input of inputs) fireEvent.change(input, { target: { value: '4242' } });
}

describe('StepPayment — beacons fire on submit', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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
    expect(initBody).toMatchObject({ adults: 1, total: '35.95' });
    expect(typeof initBody.session_id).toBe('string');

    const successBody = JSON.parse(String(successCall[1].body));
    expect(successBody.adults).toBe(1);
    expect(successBody.total).toBe('35.95');
    expect(typeof successBody.paymentRef).toBe('string');
    expect(successBody.paymentRef).toMatch(/^pay_/);

    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith('?step=2'));
  });

  // Regression: the amount must track the real `adults` count (from the
  // canonical ApplyContext), not the old hardcoded `adults: 1` from the dead
  // stub provider. 2 adults → $35.95 × 2 = $71.90 in both the display and the
  // beacon payload.
  it('amount reflects household size, not a hardcoded 1', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch' as never)
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response);

    renderWithProviders(2);

    // CTA + summary both show the multiplied total.
    expect(screen.getByRole('button', { name: /\$71\.90/ })).toBeInTheDocument();
    expect(screen.getByText('$71.90')).toBeInTheDocument();

    fillForm();
    fireEvent.click(screen.getByRole('button', { name: /pay \$/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    const [initCall] = fetchSpy.mock.calls as unknown as Array<[string, RequestInit]>;
    const initBody = JSON.parse(String(initCall[1].body));
    expect(initBody).toMatchObject({ adults: 2, total: '71.90' });
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

// FCRA §1681b consent gate. The wizard holds on the consent dialog only when
// the backend signals it (submit-draft → 400 `consumer_report_consent_required`),
// which happens when CONSUMER_REPORT_ENABLED is on and no current authorization
// exists. The gate is invisible otherwise — the other suites above run with no
// token (submit-draft is skipped), so this is the only suite that sets one.
describe('StepPayment — FCRA consent gate', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    navigateSpy.mockReset();
    sessionStorage.clear();
    // submitDraft only fires for an authed applicant (getToken()). Without this
    // the wizard never calls submit-draft and the gate can't trigger.
    localStorage.setItem('frank_tenant_token', 'test-jwt');
  });
  afterEach(() => localStorage.clear());

  // Mock differentiates by URL + body: beacons always 200; submit-draft returns
  // 400 (consent required, with the disclosure) until the request carries a
  // `consumerReportConsent`, after which it 200s. Order-independent.
  function mockConsentFlow() {
    return vi
      .spyOn(globalThis, 'fetch' as never)
      .mockImplementation((async (url: string, init?: RequestInit) => {
        if (/\/submit-draft$/.test(String(url))) {
          const body = init?.body ? JSON.parse(String(init.body)) : {};
          if (body.consumerReportConsent) {
            return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
          }
          return {
            ok: false,
            status: 400,
            json: async () => ({
              code: 'consumer_report_consent_required',
              error: 'consent required',
              disclosure: {
                version: '2026-06-01',
                text: 'FCRA-TEST-DISCLOSURE-BODY §1681b',
                hash: 'h1',
              },
            }),
          } as Response;
        }
        return { ok: true, status: 200, json: async () => ({}) } as Response;
      }) as never);
  }

  it('holds on the consent dialog, then advances once the applicant authorizes', async () => {
    const fetchSpy = mockConsentFlow();

    renderWithProviders();
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: /pay \$/i }));

    // Backend asked for consent → dialog appears and we have NOT navigated.
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    expect(navigateSpy).not.toHaveBeenCalled();
    // The exact backend disclosure text is rendered (sentinel avoids colliding
    // with the static intro copy, which also says "consumer report").
    expect(screen.getByText(/FCRA-TEST-DISCLOSURE-BODY/)).toBeInTheDocument();

    // CTA is gated on the affirmative checkbox.
    const authorize = screen.getByRole('button', { name: /authorize & continue/i });
    expect(authorize).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(authorize).toBeEnabled();

    fireEvent.click(authorize);

    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith('?step=2'));

    // Exactly two submit-draft posts: the gating probe, then the authorized one
    // carrying the consent payload with the disclosure version it was shown.
    const submitDraftCalls = (fetchSpy.mock.calls as Array<[string, RequestInit]>).filter((c) =>
      /\/submit-draft$/.test(String(c[0])),
    );
    expect(submitDraftCalls.length).toBe(2);
    const authorized = JSON.parse(String(submitDraftCalls[1][1].body));
    expect(authorized.consumerReportConsent).toMatchObject({
      authorized: true,
      disclosureVersion: '2026-06-01',
    });
  });

  it('does not navigate while the consent checkbox is unticked', async () => {
    mockConsentFlow();

    renderWithProviders();
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: /pay \$/i }));

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    // Clicking the disabled CTA without ticking does nothing.
    fireEvent.click(screen.getByRole('button', { name: /authorize & continue/i }));
    expect(navigateSpy).not.toHaveBeenCalled();
  });
});

// Phase 4b Stripe Identity handoff. When IDENTITY_VERIFICATION_ENABLED is on,
// submit-draft returns a hosted Identity session url and parks the app in
// awaiting_identity. The wizard must hold and hand the applicant off to that
// secure Stripe page (a link carrying the session url) rather than advancing.
// Flag off → no `identity` in the response → this path never triggers.
describe('StepPayment — Stripe Identity handoff', () => {
  const SESSION_URL = 'https://verify.stripe.com/start/test_session_abc';
  beforeEach(() => {
    vi.restoreAllMocks();
    navigateSpy.mockReset();
    sessionStorage.clear();
    localStorage.setItem('frank_tenant_token', 'test-jwt');
  });
  afterEach(() => localStorage.clear());

  function mockIdentityFlow() {
    return vi
      .spyOn(globalThis, 'fetch' as never)
      .mockImplementation((async (url: string) => {
        if (/\/submit-draft$/.test(String(url))) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              status: 'awaiting_identity',
              identity: { url: SESSION_URL, clientSecret: 'cs_test', status: 'requires_input' },
            }),
          } as Response;
        }
        return { ok: true, status: 200, json: async () => ({}) } as Response;
      }) as never);
  }

  it('hands off to the Stripe hosted page instead of advancing', async () => {
    const fetchSpy = mockIdentityFlow();

    renderWithProviders();
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: /pay \$/i }));

    // The identity dialog appears and we have NOT advanced to step 2.
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    expect(navigateSpy).not.toHaveBeenCalled();

    // The CTA is a real link to the Stripe hosted session url.
    const link = screen.getByRole('link', { name: /continue to verification/i });
    expect(link).toHaveAttribute('href', SESSION_URL);

    // submit-draft carried a returnUrl so Stripe can bring the applicant back.
    const submitDraftCall = (fetchSpy.mock.calls as Array<[string, RequestInit]>).find((c) =>
      /\/submit-draft$/.test(String(c[0])),
    );
    expect(submitDraftCall).toBeDefined();
    const body = JSON.parse(String(submitDraftCall![1].body));
    expect(typeof body.returnUrl).toBe('string');
    expect(body.returnUrl).toMatch(/\/status$/);
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
