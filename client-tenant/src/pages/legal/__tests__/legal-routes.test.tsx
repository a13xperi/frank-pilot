// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PrivacyPolicy } from '../PrivacyPolicy';
import { CookiesPolicy } from '../CookiesPolicy';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/privacy" element={<PrivacyPolicy />} />
        <Route path="/cookies" element={<CookiesPolicy />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('legal routes', () => {
  it('/privacy renders the privacy policy heading', () => {
    renderAt('/privacy');
    expect(
      screen.getByRole('heading', { name: /privacy policy/i, level: 1 }),
    ).toBeInTheDocument();
    // Spot-check: one of the named section headings is present
    expect(
      screen.getByRole('heading', { name: /what we collect/i, level: 2 }),
    ).toBeInTheDocument();
  });

  it('/privacy mentions the HUD/FCRA legal basis', () => {
    renderAt('/privacy');
    // Body text references the regulatory hook so we know the i18n loaded
    expect(
      screen.getAllByText(/HUD income certification|HUD income limits/i)
        .length,
    ).toBeGreaterThan(0);
  });

  it('/cookies renders the cookies policy heading', () => {
    renderAt('/cookies');
    expect(
      screen.getByRole('heading', { name: /cookies policy/i, level: 1 }),
    ).toBeInTheDocument();
  });

  it('/cookies lists frank_tenant_token under Essential', () => {
    renderAt('/cookies');
    expect(screen.getByText(/frank_tenant_token/)).toBeInTheDocument();
  });

  it('/cookies lists i18nextLng under Functional', () => {
    renderAt('/cookies');
    expect(screen.getByText(/i18nextLng/)).toBeInTheDocument();
  });
});
