// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ClaimedUnitHeader } from '../ClaimedUnitHeader';
import type { Unit } from '@/api/units';

const unit: Unit = {
  id: 'unit-abc123',
  property_id: 'prop-1',
  unit_number: '101',
  bedrooms: 1,
  bathrooms: '1',
  sqft: 650,
  monthly_rent: '1200',
  photo_url: null,
  available_from: null,
  property_name: 'Sunrise Apartments',
  property_city: 'Las Vegas',
  property_state: 'NV',
};

describe('ClaimedUnitHeader', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders "expires in 23h 30m" when 23.5h remain', () => {
    const now = Date.now();
    vi.setSystemTime(now);
    const remainingMs = (23 * 60 + 30) * 60 * 1000; // 23h 30m in ms
    const expiresAt = new Date(now + remainingMs).toISOString();

    render(<ClaimedUnitHeader unit={unit} expiresAt={expiresAt} />);

    expect(screen.getByTestId('claim-countdown')).toHaveTextContent(
      'expires in 23h 30m',
    );
  });

  it('renders "expired" when expiresAt is in the past', () => {
    const now = Date.now();
    vi.setSystemTime(now);
    const expiresAt = new Date(now - 60_000).toISOString(); // 1 min ago

    render(<ClaimedUnitHeader unit={unit} expiresAt={expiresAt} />);

    expect(screen.getByTestId('claim-countdown')).toHaveTextContent('expired');
  });

  it('renders the unit property name and unit number', () => {
    const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    render(<ClaimedUnitHeader unit={unit} expiresAt={expiresAt} />);

    expect(screen.getByText(/sunrise apartments/i)).toBeInTheDocument();
    expect(screen.getByText(/unit 101/i)).toBeInTheDocument();
  });

  it('renders the monthly rent formatted correctly', () => {
    const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    render(<ClaimedUnitHeader unit={unit} expiresAt={expiresAt} />);

    expect(screen.getByText('$1,200/mo')).toBeInTheDocument();
  });

  it('renders "expires in 0h 1m" when 1 minute remains', () => {
    const now = Date.now();
    vi.setSystemTime(now);
    const expiresAt = new Date(now + 90_000).toISOString(); // 1m 30s → floors to 1m

    render(<ClaimedUnitHeader unit={unit} expiresAt={expiresAt} />);

    expect(screen.getByTestId('claim-countdown')).toHaveTextContent(
      'expires in 0h 1m',
    );
  });
});
