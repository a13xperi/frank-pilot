import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ─────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────

// Stub the Stripe SDKs so tests never reach out to js.stripe.com. We assert
// against shape (loadStripe was called, Elements wraps children) rather than
// against a real SDK.
const loadStripeMock = vi.fn(() => Promise.resolve({ __stripe: true }));
vi.mock('@stripe/stripe-js', () => ({
  loadStripe: (...args: unknown[]) => loadStripeMock(...args),
}));

vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children, options }: { children: React.ReactNode; options?: { clientSecret?: string } }) => (
    <div data-testid="stripe-elements" data-client-secret={options?.clientSecret}>
      {children}
    </div>
  ),
  PaymentElement: () => <div data-testid="stripe-payment-element" />,
  useStripe: () => ({
    confirmPayment: vi.fn().mockResolvedValue({}),
  }),
  useElements: () => ({}),
}));

// Mock the flag module so each test sets the value it wants.
const flagState: { value: boolean } = { value: false };
vi.mock('@/lib/flags', () => ({
  useFlag: () => flagState.value,
}));

// ─────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────

import { Pay } from '../Pay';

type FetchResponse = {
  ok?: boolean;
  status?: number;
  body?: unknown;
};

function jsonResponse({ ok = true, status = 200, body = {} }: FetchResponse = {}): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

interface RouteMap {
  [path: string]: FetchResponse | FetchResponse[];
}

function installFetchRouter(routes: RouteMap) {
  const calls: { url: string; init?: RequestInit }[] = [];
  // Per-path indexes so a route can serve a sequence (e.g. 409 then 200).
  const cursors: Record<string, number> = {};
  const fetchSpy = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof url === 'string' ? url : url.toString();
    calls.push({ url: href, init });
    const matchKey = Object.keys(routes).find(k => href.includes(k));
    if (!matchKey) {
      return jsonResponse({ ok: false, status: 404, body: { error: `no mock for ${href}` } });
    }
    const entry = routes[matchKey];
    const list = Array.isArray(entry) ? entry : [entry];
    const idx = Math.min(cursors[matchKey] ?? 0, list.length - 1);
    cursors[matchKey] = (cursors[matchKey] ?? 0) + 1;
    return jsonResponse(list[idx]);
  });
  vi.stubGlobal('fetch', fetchSpy);
  return { calls, fetchSpy };
}

function renderPay() {
  return render(
    <MemoryRouter>
      <Pay />
    </MemoryRouter>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────

describe('Pay (BP-08 wizard)', () => {
  beforeEach(() => {
    flagState.value = false;
    loadStripeMock.mockClear();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('flag-off renders the legacy Pay Rent surface unchanged', async () => {
    flagState.value = false;
    installFetchRouter({
      '/tenant/dashboard': {
        body: {
          activeApplication: { id: 'app-1' },
          balance: { balance: 1450, nextDueDate: '2026-06-01' },
        },
      },
    });

    renderPay();

    expect(await screen.findByRole('heading', { name: /pay rent/i })).toBeInTheDocument();
    // Legacy surface ships a literal $ amount input — Stripe Elements should
    // not exist when the flag is off.
    expect(screen.getByLabelText(/payment amount/i)).toBeInTheDocument();
    expect(screen.queryByTestId('stripe-payment-element')).not.toBeInTheDocument();
    expect(loadStripeMock).not.toHaveBeenCalled();
  });

  it('flag-on + config.enabled=false renders "Payments not available"', async () => {
    flagState.value = true;
    installFetchRouter({
      '/tenant/dashboard': {
        body: {
          activeApplication: { id: 'app-1' },
          balance: { balance: 1450, nextDueDate: '2026-06-01' },
        },
      },
      '/payments/config': {
        body: { publishableKey: null, enabled: false },
      },
    });

    renderPay();

    expect(
      await screen.findByRole('heading', { name: /payments not available/i })
    ).toBeInTheDocument();
    expect(loadStripeMock).not.toHaveBeenCalled();
  });

  it('flag-on + config.enabled=true mints an intent with the correct args', async () => {
    flagState.value = true;
    const { calls } = installFetchRouter({
      '/tenant/dashboard': {
        body: {
          activeApplication: { id: 'app-xyz' },
          balance: { balance: 1450, nextDueDate: '2026-06-01' },
        },
      },
      '/payments/config': {
        body: { publishableKey: 'pk_test_123', enabled: true },
      },
      '/payments/intents': {
        status: 201,
        body: {
          clientSecret: 'cs_live_abc',
          paymentIntentId: 'pi_abc',
          idempotencyKey: 'app-xyz:1',
        },
      },
    });

    renderPay();

    await waitFor(() =>
      expect(screen.getByTestId('stripe-payment-element')).toBeInTheDocument()
    );

    // loadStripe gets the server-provided publishable key (NOT a Vite env var).
    expect(loadStripeMock).toHaveBeenCalledWith('pk_test_123');

    // Intent POST sent exactly the contract PR #1 expects.
    const intentCall = calls.find(c => c.url.includes('/payments/intents'));
    expect(intentCall).toBeTruthy();
    expect(intentCall!.init?.method).toBe('POST');
    const body = JSON.parse(intentCall!.init!.body as string);
    expect(body).toEqual({
      applicationId: 'app-xyz',
      amountCents: 145000,
      currency: 'usd',
      attemptN: 1,
    });

    // Elements gets the server clientSecret verbatim.
    const elements = screen.getByTestId('stripe-elements');
    expect(elements.getAttribute('data-client-secret')).toBe('cs_live_abc');
  });

  it('409 from /payments/intents bumps attemptN and retries (persisted to localStorage)', async () => {
    flagState.value = true;
    const { calls } = installFetchRouter({
      '/tenant/dashboard': {
        body: {
          activeApplication: { id: 'app-blocked' },
          balance: { balance: 100, nextDueDate: null },
        },
      },
      '/payments/config': {
        body: { publishableKey: 'pk_test_xyz', enabled: true },
      },
      '/payments/intents': [
        // First attempt → server says "this attempt is in a terminal state, bump"
        { ok: false, status: 409, body: { error: 'blocked', reason: 'succeeded' } },
        // Second attempt → fresh intent
        {
          status: 201,
          body: {
            clientSecret: 'cs_after_bump',
            paymentIntentId: 'pi_2',
            idempotencyKey: 'app-blocked:2',
          },
        },
      ],
    });

    renderPay();

    await waitFor(() =>
      expect(screen.getByTestId('stripe-payment-element')).toBeInTheDocument()
    );

    const intentCalls = calls.filter(c => c.url.includes('/payments/intents'));
    expect(intentCalls.length).toBe(2);

    const firstBody = JSON.parse(intentCalls[0].init!.body as string);
    const secondBody = JSON.parse(intentCalls[1].init!.body as string);
    expect(firstBody.attemptN).toBe(1);
    expect(secondBody.attemptN).toBe(2);

    // The successful attempt is persisted so a refresh resumes from N=2.
    expect(window.localStorage.getItem('frank.bp08.attemptN.app-blocked')).toBe('2');

    // Surface confirms the new attempt number visually.
    expect(screen.getByText(/attempt #2/i)).toBeInTheDocument();
  });
});
