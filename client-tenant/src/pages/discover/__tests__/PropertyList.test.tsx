// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PropertyList } from '../PropertyList';

function renderList(initialPath = '/discover') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <PropertyList />
    </MemoryRouter>
  );
}

function tileCount(): number {
  const grid = screen.getByTestId('property-grid');
  return within(grid).queryAllByRole('link').length;
}

describe('PropertyList (GPMG fixtures)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders 17 tiles when unauthed', () => {
    renderList();
    expect(tileCount()).toBe(17);
  });

  it('filter chip "Senior" reduces count to 13', () => {
    // Counts derived from the GPMG fixture: 13 senior + 4 family = 17.
    renderList();
    fireEvent.click(screen.getByRole('button', { name: 'Senior' }));
    expect(tileCount()).toBe(13);
  });

  it('filter chip "Family" reduces count to 4', () => {
    renderList();
    fireEvent.click(screen.getByRole('button', { name: 'Family' }));
    expect(tileCount()).toBe(4);
  });

  it('filter chip "Henderson" reduces to 1 with Smith Williams visible', () => {
    renderList();
    fireEvent.click(screen.getByRole('button', { name: 'Henderson' }));
    expect(tileCount()).toBe(1);
    expect(
      screen.getByText(/Smith Williams Senior Apartments/i)
    ).toBeInTheDocument();
  });

  it('each tile links to /property/:slug', () => {
    renderList();
    const grid = screen.getByTestId('property-grid');
    const links = within(grid).getAllByRole('link');
    for (const a of links) {
      expect(a.getAttribute('href')).toMatch(/^\/property\/[a-z0-9-]+$/);
    }
    // Smith Williams Senior Apartments slug check
    const smith = within(grid).getByLabelText(/Smith Williams Senior Apartments/i);
    expect(smith.getAttribute('href')).toBe(
      '/property/smith-williams-senior-apartments'
    );
  });

  // ── Wedge #8 — bedroom + availability + AMI filters ─────────────────────

  it('renders the new bedroom and availability filter chips', () => {
    renderList();
    expect(screen.getByTestId('chip-bedroom-studio')).toBeInTheDocument();
    expect(screen.getByTestId('chip-bedroom-1')).toBeInTheDocument();
    expect(screen.getByTestId('chip-bedroom-2')).toBeInTheDocument();
    expect(screen.getByTestId('chip-bedroom-3')).toBeInTheDocument();
    expect(screen.getByTestId('chip-available-now')).toBeInTheDocument();
  });

  it('clicking 2BR chip narrows results to family + mixed properties with 2BR availability', () => {
    renderList();
    const initial = tileCount();
    fireEvent.click(screen.getByTestId('chip-bedroom-2'));
    // 2BR units only exist in family + a handful of senior properties per
    // seed.ts (Louise Shell / Harry Reid / Richard Bryan + the 4 family).
    // We don't pin to an exact number to keep the test resilient against
    // future fixture additions — but the count must drop.
    const next = tileCount();
    expect(next).toBeGreaterThan(0);
    expect(next).toBeLessThan(initial);
  });

  it('toggling chips flips the active data attribute (chip state mirrors URL)', () => {
    // Under MemoryRouter, useSearchParams writes to the in-memory history
    // stack — not window.location. The user-visible signal is the chip's
    // active state, which we drive off the same param via data-active.
    renderList();
    const bedroom2 = screen.getByTestId('chip-bedroom-2');
    const availNow = screen.getByTestId('chip-available-now');
    expect(bedroom2.getAttribute('data-active')).toBe('false');
    expect(availNow.getAttribute('data-active')).toBe('false');
    fireEvent.click(bedroom2);
    fireEvent.click(availNow);
    // Re-query because React swaps the elements on rerender.
    expect(screen.getByTestId('chip-bedroom-2').getAttribute('data-active')).toBe(
      'true'
    );
    expect(screen.getByTestId('chip-available-now').getAttribute('data-active')).toBe(
      'true'
    );
    // Re-clicking the available-now chip toggles back off.
    fireEvent.click(screen.getByTestId('chip-available-now'));
    expect(screen.getByTestId('chip-available-now').getAttribute('data-active')).toBe(
      'false'
    );
  });

  it('renders availability badge per tile (3 available / Fully leased)', () => {
    renderList();
    const grid = screen.getByTestId('property-grid');
    const badges = within(grid).getAllByTestId('availability-badge');
    // 17 tiles → 17 badges. Each badge must be either "N available" or
    // "Fully leased" — the deterministic seed should yield at least one
    // available badge across the catalog (70% available target).
    expect(badges.length).toBe(17);
    const states = badges.map((b) => b.getAttribute('data-state'));
    expect(states).toContain('available');
  });

  it('deep-linking ?amiTier=60 shows dismissible banner and pre-filters', () => {
    renderList('/discover?amiTier=60');
    const banner = screen.getByTestId('ami-banner');
    expect(banner).toBeInTheDocument();
    expect(banner.textContent).toMatch(/60% AMI/);
    // Clicking dismiss should remove the banner from the DOM.
    fireEvent.click(screen.getByTestId('ami-banner-dismiss'));
    expect(screen.queryByTestId('ami-banner')).not.toBeInTheDocument();
  });

  it('?amiTier=80 hides all 17 GPMG properties (set-aside 60% AMI fails the slice)', () => {
    renderList('/discover?amiTier=80');
    // All seeded properties are 60% AMI — none qualify for an 80%-only slice.
    expect(tileCount()).toBe(0);
  });

  // ── Wedge #9 — rent ranges + AMI tier chip ──────────────────────────────

  it('renders an AMI tier chip ("60% AMI") on every GPMG tile', () => {
    renderList();
    // Every fixture is at 60% AMI; chip carries data-testid `ami-tier-chip-<slug>`.
    const grid = screen.getByTestId('property-grid');
    // Smith Williams chip carries the canonical "60% AMI" label.
    const smithChip = within(grid).getByTestId(
      'ami-tier-chip-smith-williams-senior-apartments'
    );
    expect(smithChip).toHaveTextContent('60% AMI');
    // Tooltip / aria-label is the long-form set-aside explainer.
    expect(smithChip.getAttribute('aria-label')).toMatch(
      /Set-aside for households at or below 60% AMI/i
    );
    expect(smithChip.getAttribute('title')).toMatch(/60% AMI/);
  });

  it('renders rent range row on each tile with bucket figures from the seed', () => {
    renderList();
    const grid = screen.getByTestId('property-grid');
    // Hoggard is the family property — Studio bucket is null, 1BR/2BR/3BR populated.
    // Expect a single rent-row testid per tile, with all three labels visible.
    const hoggardRow = within(grid).getByTestId(
      'rent-row-david-j-hoggard-family-community'
    );
    expect(hoggardRow.textContent).toMatch(/1BR/);
    expect(hoggardRow.textContent).toMatch(/\$995/);
    expect(hoggardRow.textContent).toMatch(/2BR/);
    expect(hoggardRow.textContent).toMatch(/\$1,194/);
    expect(hoggardRow.textContent).toMatch(/3BR/);
    // 3BR + 4BR collapse → range "$1,380–$1,539".
    expect(hoggardRow.textContent).toMatch(/\$1,380.+\$1,539/);
  });

  it('Aldene (senior-only) rent row shows Studio + 1BR only — no 2BR/3BR placeholders', () => {
    renderList();
    const grid = screen.getByTestId('property-grid');
    const aldeneRow = within(grid).getByTestId(
      'rent-row-aldene-kline-barlow-senior-apartments'
    );
    expect(aldeneRow.textContent).toMatch(/Studio/);
    expect(aldeneRow.textContent).toMatch(/\$747/);
    expect(aldeneRow.textContent).toMatch(/1BR/);
    expect(aldeneRow.textContent).toMatch(/\$995/);
    expect(aldeneRow.textContent).not.toMatch(/2BR/);
    expect(aldeneRow.textContent).not.toMatch(/3BR/);
  });
});

// ── Wedge #8 (live API) ─────────────────────────────────────────────────────
//
// PropertyList now calls `GET /api/properties?…` and hydrates tiles from the
// response when it succeeds. The fallback path (errors / unauthed visitors)
// is the same deterministic GPMG_FIXTURES + getPropertyAvailability render
// the discover surface used pre-wedge-8 — that path is covered by the suite
// above (those tests do not mock fetch; the call rejects in jsdom and we
// silently fall back).
//
// The contract under test below is the wire shape: the right param names
// land on the right requests, and a successful response drives the grid
// from the API row order.

interface CapturedRequest {
  url: string;
  params: URLSearchParams;
}

function mockPropertiesEndpoint(
  responder: (params: URLSearchParams) => {
    status: number;
    body: unknown;
  } | { reject: true },
): { captured: CapturedRequest[]; fetchMock: ReturnType<typeof vi.fn> } {
  const captured: CapturedRequest[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    // The /discover page only consumes /api/properties. Anything else
    // (e.g. the auth-warm fetchUnits call) we resolve to a benign 200 so
    // it doesn't pollute the capture log or trigger noisy 404 fallbacks.
    if (!url.includes('/api/properties') || url.includes('/api/applicants')) {
      return new Response(JSON.stringify({}), { status: 200 });
    }
    const [, query = ''] = url.split('?');
    const params = new URLSearchParams(query);
    captured.push({ url, params });
    const verdict = responder(params);
    if ('reject' in verdict) throw new Error('network fail');
    return new Response(JSON.stringify(verdict.body), {
      status: verdict.status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { captured, fetchMock };
}

function makeApiProperty(overrides: Partial<{
  id: string;
  name: string;
  city: string;
  propertyType: 'senior' | 'family' | 'mixed_use';
  amiTier: string | null;
  availableCount: number;
  totalUnits: number;
  bedroomBreakdown: { studio: number; br1: number; br2: number; br3: number };
}> = {}) {
  return {
    id: overrides.id ?? 'p-1',
    name: overrides.name ?? 'Live Apartment One',
    addressLine1: '100 Main St',
    addressLine2: null,
    city: overrides.city ?? 'Las Vegas',
    state: 'NV',
    zip: '89101',
    propertyType: overrides.propertyType ?? 'family',
    amiTier: overrides.amiTier ?? '60% AMI',
    availability: {
      availableCount: overrides.availableCount ?? 5,
      leasedCount: 2,
      totalUnits: overrides.totalUnits ?? 20,
      bedroomBreakdown:
        overrides.bedroomBreakdown ?? { studio: 0, br1: 2, br2: 3, br3: 0 },
    },
    rentRange: {
      studio: null,
      br1: { low: 900, high: 1100 },
      br2: { low: 1200, high: 1400 },
      br3: null,
    },
  };
}

describe('PropertyList (live /api/properties)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('?bedroom=2 + ?amiTier=60 → fetch URL carries both server-validated params', async () => {
    const { captured } = mockPropertiesEndpoint(() => ({
      status: 200,
      body: { properties: [makeApiProperty()], total: 1 },
    }));
    renderList('/discover?bedroom=2&amiTier=60');
    await waitFor(() => expect(captured.length).toBeGreaterThan(0));
    const last = captured[captured.length - 1]!;
    expect(last.params.get('bedroom')).toBe('2');
    expect(last.params.get('amiTier')).toBe('60');
    // Tile renders from the API response name, not GPMG_FIXTURES.
    expect(await screen.findByText('Live Apartment One')).toBeInTheDocument();
  });

  it('?availability=available_now + ?bedroom=studio → fetch URL carries both server params', async () => {
    const { captured } = mockPropertiesEndpoint(() => ({
      status: 200,
      body: {
        properties: [
          makeApiProperty({
            id: 'p-2',
            name: 'Studio Tower',
            propertyType: 'senior',
            bedroomBreakdown: { studio: 4, br1: 0, br2: 0, br3: 0 },
            availableCount: 4,
            totalUnits: 12,
          }),
        ],
        total: 1,
      },
    }));
    renderList('/discover?availability=available_now&bedroom=studio');
    await waitFor(() => expect(captured.length).toBeGreaterThan(0));
    const last = captured[captured.length - 1]!;
    expect(last.params.get('availability')).toBe('available_now');
    expect(last.params.get('bedroom')).toBe('studio');
    expect(await screen.findByText('Studio Tower')).toBeInTheDocument();
  });

  it('API returns empty properties array → empty-state count copy renders', async () => {
    mockPropertiesEndpoint(() => ({
      status: 200,
      body: { properties: [], total: 0 },
    }));
    renderList('/discover?bedroom=3&amiTier=80');
    // Wait for the API result to apply (count drops to 0). The pre-existing
    // copy is the result-count footer — same as the unauthed empty result.
    await waitFor(() => {
      expect(screen.getByTestId('result-count').textContent).toBe(
        '0 communities',
      );
    });
    expect(tileCount()).toBe(0);
  });

  it('fetch rejects → fallback render keeps all 17 deterministic fixture tiles', async () => {
    // Server 500 / network failure / 401 unauthed all surface as a thrown
    // error in api/client.ts. The discover surface must keep showing the
    // 17-property deterministic catalog so the gpmglv demo walkthrough
    // still works when the API is unreachable.
    mockPropertiesEndpoint(() => ({ reject: true }));
    renderList();
    // Initial render hydrates from GPMG_FIXTURES because apiProperties starts
    // null. After the rejected fetch settles, apiProperties stays null and
    // the fixture render persists.
    expect(tileCount()).toBe(17);
    // Give the rejected promise a microtask to settle, then re-assert.
    await waitFor(() => expect(tileCount()).toBe(17));
  });

  it('API success rewires availability count from the response (no client-side seed mirror)', async () => {
    // The wire is load-bearing: the contract is "use the server's rollup,
    // do not re-derive from PROPERTY_UNIT_MIX". If the API says 0 available
    // for a property the tile must reflect that — even if the deterministic
    // seed mirror would have said 7.
    mockPropertiesEndpoint(() => ({
      status: 200,
      body: {
        properties: [
          makeApiProperty({
            id: 'p-3',
            name: 'Empty House',
            availableCount: 0,
            totalUnits: 10,
            bedroomBreakdown: { studio: 0, br1: 0, br2: 0, br3: 0 },
          }),
        ],
        total: 1,
      },
    }));
    renderList();
    const grid = await screen.findByTestId('property-grid');
    await waitFor(() => {
      // Single tile from the API.
      expect(within(grid).queryAllByRole('link')).toHaveLength(1);
    });
    const badge = within(grid).getByTestId('availability-badge');
    expect(badge.getAttribute('data-state')).toBe('fully-leased');
  });
});
