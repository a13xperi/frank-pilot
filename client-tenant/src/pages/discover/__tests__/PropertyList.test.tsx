// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
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
