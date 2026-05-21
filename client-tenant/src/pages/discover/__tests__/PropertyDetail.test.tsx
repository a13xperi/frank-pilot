// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import axe from 'axe-core';
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

describe('PropertyDetail', () => {
  beforeEach(() => {
    // /applicants/properties/donna-louise-2 → 404 (forces fixture fallback)
    // /applicants/properties/.../waitlist-summary → 404 (forces stub)
    vi.spyOn(window, 'fetch' as never).mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'not found' }),
    } as never);
  });

  it('renders DL2 fixture with carousel, amenities, banner', async () => {
    renderAt('/property/donna-louise-2');
    await waitFor(() => {
      expect(screen.getByText('Donna Louise 2')).toBeInTheDocument();
    });
    expect(screen.getByTestId('photo-carousel')).toBeInTheDocument();
    expect(screen.getByText(/Amenities/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('waitlist-banner')).toBeInTheDocument();
    });
  });

  it('shows not-found for unknown slug', async () => {
    renderAt('/property/does-not-exist');
    await waitFor(() => {
      expect(screen.getByText(/not found/i)).toBeInTheDocument();
    });
  });

  it('passes axe-core accessibility scan', async () => {
    const { container } = renderAt('/property/donna-louise-2');
    await waitFor(() => {
      expect(screen.getByText('Donna Louise 2')).toBeInTheDocument();
    });
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });
});
