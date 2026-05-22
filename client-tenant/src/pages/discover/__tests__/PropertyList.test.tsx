// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PropertyList } from '../PropertyList';

function renderList() {
  return render(
    <MemoryRouter>
      <PropertyList />
    </MemoryRouter>
  );
}

function tileCount(): number {
  const grid = screen.getByTestId('property-grid');
  return within(grid).getAllByRole('link').length;
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
});
