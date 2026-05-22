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
});
