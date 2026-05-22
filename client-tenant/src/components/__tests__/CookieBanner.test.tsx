// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { CookieBanner } from '../CookieBanner';
import {
  CONSENT_STORAGE_KEY,
  _rehydrateForTests,
  getConsentSnapshot,
} from '@/state/consent';

function renderBanner() {
  return render(
    <MemoryRouter>
      <CookieBanner />
    </MemoryRouter>,
  );
}

describe('CookieBanner', () => {
  beforeEach(() => {
    window.localStorage.clear();
    _rehydrateForTests();
  });

  it('renders when recordedAt is null (fresh visit)', () => {
    renderBanner();
    expect(screen.getByTestId('cookie-banner')).toBeInTheDocument();
  });

  it('hides after Accept all is clicked', async () => {
    const user = userEvent.setup();
    renderBanner();
    await user.click(screen.getByTestId('cookie-banner-accept-all'));
    expect(screen.queryByTestId('cookie-banner')).not.toBeInTheDocument();
    expect(getConsentSnapshot().functional).toBe(true);
    expect(getConsentSnapshot().marketing).toBe(true);
  });

  it('hides after Reject non-essential is clicked', async () => {
    const user = userEvent.setup();
    renderBanner();
    await user.click(screen.getByTestId('cookie-banner-reject-all'));
    expect(screen.queryByTestId('cookie-banner')).not.toBeInTheDocument();
    const s = getConsentSnapshot();
    expect(s.essential).toBe(true);
    expect(s.functional).toBe(false);
    expect(s.analytics).toBe(false);
    expect(s.marketing).toBe(false);
  });

  it('Customize opens the preferences modal', async () => {
    const user = userEvent.setup();
    renderBanner();
    expect(
      screen.queryByTestId('cookie-preferences-modal'),
    ).not.toBeInTheDocument();
    await user.click(screen.getByTestId('cookie-banner-customize'));
    expect(screen.getByTestId('cookie-preferences-modal')).toBeInTheDocument();
  });

  it('does NOT render when consent was previously recorded', () => {
    window.localStorage.setItem(
      CONSENT_STORAGE_KEY,
      JSON.stringify({
        essential: true,
        functional: true,
        analytics: false,
        marketing: false,
        recordedAt: '2026-05-22T00:00:00.000Z',
      }),
    );
    _rehydrateForTests();
    renderBanner();
    expect(screen.queryByTestId('cookie-banner')).not.toBeInTheDocument();
  });
});
