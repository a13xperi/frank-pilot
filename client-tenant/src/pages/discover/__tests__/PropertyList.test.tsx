// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PropertyList } from '../PropertyList';

describe('PropertyList smoke', () => {
  beforeEach(() => {
    // Unauthed -> fixture path. No fetch needed.
    window.localStorage.clear();
  });

  it('renders DL2 fixture when unauthenticated (public route)', async () => {
    render(
      <MemoryRouter>
        <PropertyList />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByText(/Donna Louise 2/i)).toBeInTheDocument();
    });
  });

  it('links each tile to /property/:slug', async () => {
    render(
      <MemoryRouter>
        <PropertyList />
      </MemoryRouter>
    );
    await waitFor(() => {
      const link = screen.getByRole('link', { name: /Donna Louise 2/i });
      expect(link.getAttribute('href')).toBe('/property/donna-louise-2');
    });
  });

  it('renders authenticated path using fetched units', async () => {
    window.localStorage.setItem('frank_tenant_token', 'test');
    const fetchSpy = vi.spyOn(window, 'fetch' as never).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        units: [
          {
            id: 'u1',
            property_id: 'p1',
            unit_number: '101',
            bedrooms: 2,
            bathrooms: 1,
            sqft: 900,
            monthly_rent: 920,
            photo_url: null,
            available_from: null,
            property_name: 'Donna Louise 2',
            property_city: 'Las Vegas',
            property_state: 'NV',
          },
        ],
      }),
    } as never);
    render(
      <MemoryRouter>
        <PropertyList />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByText(/Donna Louise 2/i)).toBeInTheDocument();
    });
    fetchSpy.mockRestore();
  });
});
