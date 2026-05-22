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

  it('renders amenities grid', () => {
    renderAt('/property/owens-senior-housing');
    expect(screen.getByText('Affordable rents')).toBeInTheDocument();
    expect(screen.getByText('Smoke-free')).toBeInTheDocument();
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

  it('renders the HUD-LV income limits disclosure with rows 1–8 (60% AMI)', () => {
    renderAt('/property/owens-senior-housing');
    const disclosure = screen.getByTestId('income-limits-disclosure');
    expect(disclosure).toBeInTheDocument();
    // Header copy
    expect(disclosure.textContent).toMatch(/Las Vegas-Henderson-Paradise MSA/);
    // 8 household-size rows
    for (let i = 1; i <= 8; i++) {
      expect(screen.getByTestId(`income-limits-row-${i}`)).toBeInTheDocument();
    }
    // Anchor: household size 4 @ 60% AMI = $51,840 per ami.ts.
    expect(screen.getByTestId('income-limits-row-4').textContent).toMatch(
      /\$51,840/
    );
    // Anchor: household size 1 @ 60% AMI = $36,300.
    expect(screen.getByTestId('income-limits-row-1').textContent).toMatch(
      /\$36,300/
    );
  });
});
