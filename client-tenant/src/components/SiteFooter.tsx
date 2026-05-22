/**
 * SiteFooter — minimal global footer.
 *
 * Mounted alongside CookieBanner in App.tsx so it appears on every
 * route. Three links: Privacy, Cookies, Cookie preferences (opens the
 * preferences modal via the consent store's clearAndReprompt + a small
 * local event — actually, we mount our own modal here so we don't need
 * to coordinate with the banner).
 *
 * Visually subtle so it doesn't fight existing per-page layouts.
 *
 * gpmglv wedge #15.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { HF } from '@/styles/tokens';
import { CookiePreferencesModal } from './CookiePreferencesModal';

export function SiteFooter() {
  const { t } = useTranslation('legal');
  const [prefsOpen, setPrefsOpen] = useState(false);

  return (
    <>
      <footer
        data-testid="site-footer"
        className="px-4 py-4 text-xs sm:px-6 sm:py-5"
        style={{
          background: HF.cream,
          color: HF.ink3,
          borderTop: `1px solid ${HF.border}`,
          fontFamily: HF.body,
        }}
      >
        <div className="mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span style={{ color: HF.ink3 }}>{t('footer.tagline')}</span>
          <nav
            className="flex flex-wrap items-center gap-x-4 gap-y-2"
            aria-label="Legal"
          >
            <Link
              to="/privacy"
              style={{ color: HF.ink2, textDecoration: 'underline' }}
            >
              {t('footer.privacy')}
            </Link>
            <Link
              to="/cookies"
              style={{ color: HF.ink2, textDecoration: 'underline' }}
            >
              {t('footer.cookies')}
            </Link>
            <button
              type="button"
              data-testid="footer-cookie-preferences"
              onClick={() => setPrefsOpen(true)}
              style={{
                color: HF.ink2,
                textDecoration: 'underline',
                background: 'transparent',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                font: 'inherit',
              }}
            >
              {t('footer.preferences')}
            </button>
          </nav>
        </div>
      </footer>
      <CookiePreferencesModal
        open={prefsOpen}
        onClose={() => setPrefsOpen(false)}
      />
    </>
  );
}
