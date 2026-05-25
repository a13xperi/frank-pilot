// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { PropertyDetail } from '../PropertyDetail';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/property/:slug" element={<PropertyDetail />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('PropertyDetail (GPMG fixture)', () => {
  it('renders hero with property name and address', () => {
    renderAt('/property/smith-williams-senior-apartments');
    expect(
      screen.getByRole('heading', { name: /Smith Williams Senior Apartments/i })
    ).toBeInTheDocument();
    expect(screen.getByText(/575 E\. Lake Mead Pkwy\./i)).toBeInTheDocument();
    expect(screen.getByText(/Henderson, NV 89015/i)).toBeInTheDocument();
  });

  it('legacy donna-louise-2 slug still resolves to DL2', () => {
    renderAt('/property/donna-louise-2');
    expect(
      screen.getByRole('heading', { name: /Donna Louise Apartments 2/i })
    ).toBeInTheDocument();
  });

  it('"Apply now" CTA exists and is wired', () => {
    renderAt('/property/owens-senior-housing');
    const cta = screen.getByTestId('apply-cta');
    expect(cta).toHaveTextContent(/Apply now/i);
  });

  it('renders amenities grid with the core representative amenities', () => {
    renderAt('/property/owens-senior-housing');
    expect(screen.getByTestId('amenities-grid')).toBeInTheDocument();
    // Core amenities are present for every community.
    expect(screen.getByText('On-site laundry')).toBeInTheDocument();
    expect(screen.getByText('Smoke-free')).toBeInTheDocument();
    expect(screen.getByText('Near transit')).toBeInTheDocument();
    // Honest disclosure that these are representative.
    expect(
      screen.getByText(/Representative amenities/i)
    ).toBeInTheDocument();
  });

  it('renders floor plans driven by real rent + availability', () => {
    renderAt('/property/david-j-hoggard-family-community');
    const grid = screen.getByTestId('floor-plan-grid');
    expect(grid).toBeInTheDocument();
    // Hoggard offers 1BR/2BR/3BR — at least three plan cards.
    expect(grid.querySelectorAll('li').length).toBeGreaterThanOrEqual(3);
    // Real seeded rent surfaces on the plan card.
    expect(screen.getByTestId('floor-plan-br1').textContent).toMatch(/\$995/);
    // Representative-size footnote is shown.
    expect(screen.getByText(/Unit sizes are representative/i)).toBeInTheDocument();
  });

  it('renders neighborhood scores and nearby places, labelled representative', () => {
    renderAt('/property/owens-senior-housing');
    expect(screen.getByTestId('neighborhood')).toBeInTheDocument();
    expect(screen.getByTestId('neighborhood-scores')).toBeInTheDocument();
    expect(screen.getByTestId('neighborhood-nearby')).toBeInTheDocument();
    expect(screen.getByText('Walkability')).toBeInTheDocument();
    expect(
      screen.getByText(/Representative neighborhood estimates/i)
    ).toBeInTheDocument();
  });

  it('shows not-found for unknown slug', () => {
    renderAt('/property/does-not-exist');
    expect(screen.getByText(/Property not found/i)).toBeInTheDocument();
  });

  // ── Wedge #8 — live availability section ─────────────────────────────────

  it('renders Live availability section with per-bedroom counts', () => {
    renderAt('/property/david-j-hoggard-family-community');
    expect(screen.getByTestId('live-availability')).toBeInTheDocument();
    // Hoggard has 1BR/2BR/3BR/4BR — should render at least 3 bedroom rows
    // (4BR collapses onto br3 with the deterministic 70% available logic).
    const grid = screen.getByTestId('availability-grid');
    expect(grid).toBeInTheDocument();
    const rows = grid.querySelectorAll('li');
    expect(rows.length).toBeGreaterThanOrEqual(3);
  });

  it('renders Apply-for-property CTA when at least one unit is available', () => {
    renderAt('/property/david-j-hoggard-family-community');
    const cta = screen.getByTestId('apply-for-property-cta');
    expect(cta).toBeInTheDocument();
    expect(cta.textContent).toMatch(/Apply for this property/i);
  });

  // ── Wedge #9 — Rent & AMI disclosure ────────────────────────────────────

  it('renders the Rent & AMI disclosure section with per-bedroom rent table', () => {
    renderAt('/property/david-j-hoggard-family-community');
    const section = screen.getByTestId('rent-ami-disclosure');
    expect(section).toBeInTheDocument();
    const table = screen.getByTestId('rent-table');
    expect(table).toBeInTheDocument();
    // Hoggard: 1BR=$995, 2BR=$1,194, 3BR=$1,380–$1,539 (3BR+4BR collapse).
    expect(screen.getByTestId('rent-row-br1').textContent).toMatch(/\$995/);
    expect(screen.getByTestId('rent-row-br2').textContent).toMatch(/\$1,194/);
    expect(screen.getByTestId('rent-row-br3').textContent).toMatch(
      /\$1,380.+\$1,539/
    );
    // No Studio row for Hoggard (family-only).
    expect(screen.queryByTestId('rent-row-studio')).not.toBeInTheDocument();
  });

  it('renders the 60% AMI set-aside explainer with income calculator link to "/"', () => {
    renderAt('/property/owens-senior-housing');
    const explainer = screen.getByTestId('set-aside-explainer');
    expect(explainer.textContent).toMatch(/Set-aside: 60% AMI/);
    expect(explainer.textContent).toMatch(/Las Vegas Area Median Income/);
    const link = screen.getByTestId('income-calculator-link');
    expect(link.getAttribute('href')).toBe('/');
    expect(link.textContent).toMatch(/income calculator/i);
  });

  it('renders the official 2026 income limits disclosure with rows 1–12 (60% AMI)', () => {
    renderAt('/property/owens-senior-housing');
    const disclosure = screen.getByTestId('income-limits-disclosure');
    expect(disclosure).toBeInTheDocument();
    // Data-driven MSA name from the 2026 Novogradac Clark County export.
    expect(disclosure.textContent).toMatch(
      /Las Vegas-Henderson-North Las Vegas, NV MSA/
    );
    // 12 household-size rows (expanded from the old 1–8 stub).
    for (let i = 1; i <= 12; i++) {
      expect(screen.getByTestId(`income-limits-row-${i}`)).toBeInTheDocument();
    }
    // Anchor: household size 4 @ 60% AMI = $63,300 (published 2026 limit).
    expect(screen.getByTestId('income-limits-row-4').textContent).toMatch(
      /\$63,300/
    );
    // Anchor: household size 1 @ 60% AMI = $44,340.
    expect(screen.getByTestId('income-limits-row-1').textContent).toMatch(
      /\$44,340/
    );
    // Novogradac provenance disclaimer is shown with the official numbers.
    expect(screen.getByTestId('income-limits-source').textContent).toMatch(
      /Novogradac/
    );
  });

  it('renders the official max-rent column at the 60% set-aside', () => {
    renderAt('/property/david-j-hoggard-family-community');
    // Hoggard has 1BR/2BR/3BR. Published 60% caps: 1BR=$1,187, 2BR=$1,425,
    // 3BR=$1,646. Asking rents ($995 / $1,194 / $1,380–$1,539) sit under cap.
    expect(screen.getByTestId('rent-cap-br1').textContent).toMatch(/\$1,187/);
    expect(screen.getByTestId('rent-cap-br2').textContent).toMatch(/\$1,425/);
    expect(screen.getByTestId('rent-cap-br3').textContent).toMatch(/\$1,646/);
  });
});
