// @vitest-environment jsdom
/**
 * Wedge #10 — Settings page test.
 *
 * Smokes the magic-link reset surface: page renders, button fires the right
 * endpoint, success state replaces the form, rate-limit error surfaces a
 * specific copy string. We stub `fetch` so the component exercises the real
 * api client without touching the network.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Settings } from '../Settings';

const ME_PAYLOAD = {
  user: {
    id: 'user-1',
    email: 'marisol@example.com',
    firstName: 'Marisol',
    lastName: 'R.',
    role: 'tenant',
  },
};

function mockFetchSequence(
  responses: Array<{ status: number; body?: unknown }>,
) {
  const fetchMock = vi.fn();
  for (const r of responses) {
    fetchMock.mockResolvedValueOnce({
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      statusText: '',
      json: async () => r.body ?? {},
      text: async () =>
        typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? {}),
    });
  }
  // Any unanticipated extra calls return an empty 200 to keep the test alive.
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    statusText: '',
    json: async () => ({}),
    text: async () => '{}',
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  // The api client reads VITE_API_BASE_URL via import.meta.env; we don't set
  // it here so it uses relative paths (/api/...). localStorage is shimmed in
  // ../test/setup.ts but we still want a fresh token for each test.
  window.localStorage.setItem('frank_tenant_token', 'fake-jwt');
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

function renderPage() {
  return render(
    <MemoryRouter>
      <Settings />
    </MemoryRouter>,
  );
}

describe('Settings page (wedge #10)', () => {
  it('renders the page title and the password-reset CTA', async () => {
    mockFetchSequence([{ status: 200, body: ME_PAYLOAD }]);
    renderPage();
    expect(screen.getByRole('heading', { name: /settings/i })).toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: /email me a fresh sign-in link/i }),
    ).toBeInTheDocument();
  });

  it('echoes the authenticated email from /auth/me', async () => {
    mockFetchSequence([{ status: 200, body: ME_PAYLOAD }]);
    renderPage();
    expect(await screen.findByTestId('settings-email')).toHaveTextContent(
      'marisol@example.com',
    );
  });

  it('fires POST /users/me/password-reset-email and shows the sent toast', async () => {
    const fetchMock = mockFetchSequence([
      { status: 200, body: ME_PAYLOAD }, // GET /auth/me
      { status: 204, body: '' }, // POST password-reset-email
    ]);
    renderPage();

    const btn = await screen.findByRole('button', {
      name: /email me a fresh sign-in link/i,
    });
    await act(async () => {
      fireEvent.click(btn);
    });

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        /check your email/i,
      );
    });

    const calls = fetchMock.mock.calls;
    const postCall = calls.find(
      (c) => c[1]?.method === 'POST' && String(c[0]).includes('/users/me/password-reset-email'),
    );
    expect(postCall).toBeTruthy();
    expect(postCall![1].body).toBe(JSON.stringify({}));
  });

  it('surfaces a rate-limit message when the server returns 429', async () => {
    mockFetchSequence([
      { status: 200, body: ME_PAYLOAD },
      { status: 429, body: { error: 'Too many requests, try again in a minute' } },
    ]);
    renderPage();

    const btn = await screen.findByRole('button', {
      name: /email me a fresh sign-in link/i,
    });
    await act(async () => {
      fireEvent.click(btn);
    });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        /too many links/i,
      );
    });
    // Form remained — user can retry.
    expect(
      screen.getByRole('button', { name: /email me a fresh sign-in link/i }),
    ).toBeInTheDocument();
  });
});
