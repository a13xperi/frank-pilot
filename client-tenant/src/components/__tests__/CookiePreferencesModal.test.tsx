// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CookiePreferencesModal } from '../CookiePreferencesModal';
import { _rehydrateForTests, getConsentSnapshot } from '@/state/consent';

describe('CookiePreferencesModal', () => {
  beforeEach(() => {
    window.localStorage.clear();
    _rehydrateForTests();
  });

  it('renders nothing when open=false', () => {
    render(<CookiePreferencesModal open={false} onClose={() => {}} />);
    expect(
      screen.queryByTestId('cookie-preferences-modal'),
    ).not.toBeInTheDocument();
  });

  it('renders when open=true', () => {
    render(<CookiePreferencesModal open={true} onClose={() => {}} />);
    expect(screen.getByTestId('cookie-preferences-modal')).toBeInTheDocument();
  });

  it('essential toggle is disabled (cannot be turned off)', () => {
    render(<CookiePreferencesModal open={true} onClose={() => {}} />);
    const essentialToggle = screen.getByTestId('cookie-prefs-toggle-essential');
    expect(essentialToggle).toBeDisabled();
    expect(essentialToggle).toBeChecked();
  });

  it('Save commits current draft to consent store', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<CookiePreferencesModal open={true} onClose={onClose} />);

    // Toggle analytics on
    await user.click(screen.getByTestId('cookie-prefs-toggle-analytics'));
    // Save
    await user.click(screen.getByTestId('cookie-preferences-save'));

    const s = getConsentSnapshot();
    expect(s.analytics).toBe(true);
    expect(s.functional).toBe(false); // default-off
    expect(s.marketing).toBe(false);
    expect(s.recordedAt).not.toBeNull();
    expect(onClose).toHaveBeenCalled();
  });

  it('Cancel closes without writing', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<CookiePreferencesModal open={true} onClose={onClose} />);

    await user.click(screen.getByTestId('cookie-prefs-toggle-marketing'));
    await user.click(screen.getByTestId('cookie-preferences-cancel'));

    expect(onClose).toHaveBeenCalled();
    expect(getConsentSnapshot().recordedAt).toBeNull();
    expect(getConsentSnapshot().marketing).toBeUndefined();
  });
});
