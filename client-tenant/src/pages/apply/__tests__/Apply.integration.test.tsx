import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { Apply } from '../../Apply';
import { setToken } from '@/api/client';

// One mock fetch covering every endpoint the flow touches.
function installFetch() {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    const body = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });

    if (url.includes('/applicants/register')) return body({ ok: true });
    if (url.includes('/auth/me')) {
      return body({
        user: {
          email: 'marisol@example.com',
          firstName: 'Marisol',
          lastName: 'Reyes',
          emailVerified: true,
        },
      });
    }
    if (url.includes('/applicants/me/applications')) return body({ applications: [] });
    if (url.includes('/applicants/intent') && method === 'POST') {
      return body({ ok: true, application_id: 'app-1' });
    }
    if (url.includes('/applicants/units')) {
      return body({
        units: [
          {
            id: 'unit-aaaabbbb',
            property_id: 'donna-louise-2',
            unit_number: '204',
            bedrooms: 2,
            bathrooms: '1',
            sqft: 800,
            monthly_rent: '1500',
            photo_url: null,
            available_from: null,
            property_name: 'Donna Louise II',
            property_city: 'Reno',
            property_state: 'NV',
          },
        ],
      });
    }
    if (url.includes('/applicants/claim-unit/')) {
      return body({
        ok: true,
        application_id: 'app-1',
        unit: {
          id: 'unit-aaaabbbb',
          property_id: 'donna-louise-2',
          unit_number: '204',
          bedrooms: 2,
          bathrooms: '1',
          sqft: 800,
          monthly_rent: '1500',
          photo_url: null,
          available_from: null,
          property_name: 'Donna Louise II',
          property_city: 'Reno',
          property_state: 'NV',
        },
        expires_at: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
      });
    }
    if (url.includes('/applicants/apply')) return body({ ok: true });
    return body({ error: `unmocked ${url}` }, 404);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function renderApp(route: string) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/apply" element={<Apply />} />
        <Route path="/status" element={<div>Status page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('Apply — full happy path through 7 steps', () => {
  it('progresses register → verify → intent → checklist → pick → claim → details → submit', async () => {
    installFetch();
    // Token present so the verify-stage poll auto-advances.
    setToken('test-token');

    const user = userEvent.setup();
    renderApp('/apply');

    // Step 1: Register
    expect(await screen.findByRole('heading', { name: /create your account/i })).toBeInTheDocument();
    await user.type(screen.getByLabelText(/first name/i), 'Marisol');
    await user.type(screen.getByLabelText(/last name/i), 'Reyes');
    await user.type(screen.getByLabelText(/email/i), 'marisol@example.com');
    await user.click(screen.getByRole('button', { name: /^continue$/i }));

    // Step 2: Verify — auto-advances to intent once /auth/me reports emailVerified.
    // (Verify heading may flash too briefly to assert; intent heading is the stable signal.)
    expect(await screen.findByRole('heading', { name: /what are you looking for/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^2 BR$/i }));
    await user.type(screen.getByLabelText(/target move-in/i), '2026-09-01');
    await user.click(screen.getByRole('button', { name: /show me units/i }));

    // Step 4: Checklist (NEW)
    expect(await screen.findByRole('heading', { name: /before you apply/i })).toBeInTheDocument();
    expect(screen.getByText(/\$35\.95/)).toBeInTheDocument();
    expect(screen.getByText(/120 days/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /continue/i }));

    // Step 5: Pick
    expect(await screen.findByRole('heading', { name: /pick your unit/i })).toBeInTheDocument();
    const claimBtn = await screen.findByRole('button', { name: /claim/i });
    await user.click(claimBtn);

    // Step 6: Claim confirmation
    expect(await screen.findByRole('heading', { name: /unit 204 is yours/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /continue your application/i }));

    // Step 7: Details
    expect(await screen.findByRole('heading', { name: /application details/i })).toBeInTheDocument();
    await user.type(screen.getByLabelText(/social security number/i), '123-45-6789');
    await user.type(screen.getByLabelText(/date of birth/i), '1990-01-01');
    await user.click(screen.getByRole('button', { name: /submit application/i }));

    // Submitted screen
    await waitFor(() => {
      expect(screen.getByText(/application submitted/i)).toBeInTheDocument();
    });
  }, 30000);
});

// Issue #8 regression — deep-linking to ?step=intent must not paint the empty
// quiz before the hydration fetch resolves. We assert the skeleton renders
// first (heading absent), then the quiz heading appears.
describe('Apply — issue #8 deep-link hydration', () => {
  it('renders skeleton on ?step=intent until hydration completes', async () => {
    let resolveMe!: (v: unknown) => void;
    const mePromise = new Promise((res) => {
      resolveMe = res;
    });
    const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';
      const body = (data: unknown, status = 200) =>
        new Response(JSON.stringify(data), {
          status,
          headers: { 'Content-Type': 'application/json' },
        });
      if (url.includes('/auth/me')) {
        await mePromise;
        return body({
          user: {
            email: 'm@example.com',
            firstName: 'M',
            lastName: 'R',
            emailVerified: true,
          },
        });
      }
      if (url.includes('/applicants/me/applications')) {
        return body({ applications: [] });
      }
      if (url.includes('/applicants/intent') && method === 'POST') {
        return body({ ok: true });
      }
      return body({ error: `unmocked ${url}` }, 404);
    });
    vi.stubGlobal('fetch', fn);
    setToken('test-token');

    render(
      <MemoryRouter initialEntries={['/apply?step=intent']}>
        <Routes>
          <Route path="/apply" element={<Apply />} />
        </Routes>
      </MemoryRouter>,
    );

    // Skeleton first; quiz heading must NOT be present while hydration pends.
    expect(await screen.findByTestId('intent-skeleton')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /what are you looking for/i })).toBeNull();

    // Resolve hydration → real form swaps in.
    resolveMe(undefined);
    expect(
      await screen.findByRole('heading', { name: /what are you looking for/i }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('intent-skeleton')).toBeNull();
  }, 15000);
});

// Issue #9 regression — advancing steps must merge with existing query params
// rather than overwriting them. We seed utm_source/unitType, advance the
// wizard, and assert both survive alongside the new step param.
describe('Apply — issue #9 query param merge', () => {
  function LocationProbe() {
    const loc = useLocation();
    return <div data-testid="loc-search">{loc.search}</div>;
  }

  it('preserves utm_* and inbound handoff params across setStep transitions', async () => {
    const fn = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      const body = (data: unknown, status = 200) =>
        new Response(JSON.stringify(data), {
          status,
          headers: { 'Content-Type': 'application/json' },
        });
      if (url.includes('/auth/me')) {
        return body({
          user: {
            email: 'm@example.com',
            firstName: 'M',
            lastName: 'R',
            emailVerified: true,
          },
        });
      }
      if (url.includes('/applicants/me/applications')) return body({ applications: [] });
      if (url.includes('/applicants/intent')) return body({ ok: true, application_id: 'a' });
      return body({ error: `unmocked ${url}` }, 404);
    });
    vi.stubGlobal('fetch', fn);
    setToken('test-token');

    const user = userEvent.setup();
    render(
      <MemoryRouter
        initialEntries={[
          '/apply?step=intent&utm_source=newsletter&utm_campaign=launch&unitType=2BR',
        ]}
      >
        <Routes>
          <Route
            path="/apply"
            element={
              <>
                <Apply />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    // Wait for hydration → real form.
    await screen.findByRole('heading', { name: /what are you looking for/i });
    await user.click(screen.getByRole('button', { name: /^2 BR$/i }));
    await user.type(screen.getByLabelText(/target move-in/i), '2026-09-01');
    await user.click(screen.getByRole('button', { name: /show me units/i }));

    // Advanced to checklist — utm_* + unitType must survive alongside the new step.
    const probe = await screen.findByTestId('loc-search');
    await waitFor(() => {
      expect(probe.textContent ?? '').toMatch(/step=checklist/);
    });
    const search = probe.textContent ?? '';
    expect(search).toMatch(/utm_source=newsletter/);
    expect(search).toMatch(/utm_campaign=launch/);
    expect(search).toMatch(/unitType=2BR/);
  }, 15000);
});
