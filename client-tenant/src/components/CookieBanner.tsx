/**
 * CookieBanner — bottom-fixed consent prompt.
 *
 * Mounts globally (see App.tsx). Shows when `useConsent().recordedAt === null`.
 * Three actions:
 *   - Accept all  → all categories on, banner dismisses
 *   - Reject non-essential → only essentials, banner dismisses
 *   - Customize  → opens the preferences modal
 *
 * Esc dismisses to a "reject non-essential" state, matching the
 * privacy-preserving default. The banner is `role="dialog"` (a soft
 * dialog — not modal) and keyboard-reachable. No focus trap, on
 * purpose — it's a banner, the user can still interact with the page.
 *
 * gpmglv wedge #15.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HF } from '@/styles/tokens';
import { useConsent } from '@/state/consent';
import { CookiePreferencesModal } from './CookiePreferencesModal';

export function CookieBanner() {
  const { t } = useTranslation('legal');
  const { needsChoice, acceptAll, rejectAll } = useConsent();
  const [modalOpen, setModalOpen] = useState(false);

  // Esc dismisses to "reject non-essential" — the privacy-preserving
  // default if the user wants to make the banner go away without
  // explicitly choosing. The modal handles its own Esc.
  useEffect(() => {
    if (!needsChoice || modalOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') rejectAll();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [needsChoice, modalOpen, rejectAll]);

  // Modal can be opened from this banner or from the footer link, so
  // we always render <CookiePreferencesModal /> — but when the user
  // has already recorded a choice, no banner is shown.
  if (!needsChoice) {
    return (
      <CookiePreferencesModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      />
    );
  }

  return (
    <>
      <div
        role="dialog"
        aria-labelledby="cookie-banner-title"
        aria-label={t('banner.ariaLabel')}
        data-testid="cookie-banner"
        className="fixed inset-x-0 bottom-0 z-50 flex justify-center px-3 pb-3 sm:px-4 sm:pb-4"
        style={{ pointerEvents: 'none' }}
      >
        <div
          className="w-full max-w-3xl"
          style={{
            background: HF.paper,
            border: `1px solid ${HF.border}`,
            borderRadius: HF.r.lg,
            boxShadow: HF.shadow.lg,
            color: HF.ink,
            fontFamily: HF.body,
            pointerEvents: 'auto',
            padding: 16,
          }}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
            <div className="flex-1 text-sm">
              <h2
                id="cookie-banner-title"
                className="mb-1 text-base font-semibold"
                style={{ fontFamily: HF.display, color: HF.ink }}
              >
                {t('banner.title')}
              </h2>
              <p style={{ color: HF.ink2, lineHeight: 1.5 }}>
                {t('banner.body')}
              </p>
              <p className="mt-2 text-xs" style={{ color: HF.ink3 }}>
                <a
                  href="/privacy"
                  style={{ color: HF.accent, textDecoration: 'underline' }}
                >
                  {t('banner.privacyLink')}
                </a>
                <span aria-hidden="true"> · </span>
                <a
                  href="/cookies"
                  style={{ color: HF.accent, textDecoration: 'underline' }}
                >
                  {t('banner.cookiesLink')}
                </a>
              </p>
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-col sm:items-stretch sm:justify-center">
              <button
                type="button"
                data-testid="cookie-banner-customize"
                onClick={() => setModalOpen(true)}
                className="text-sm font-medium"
                style={{
                  background: 'transparent',
                  color: HF.ink2,
                  border: `1px solid ${HF.border}`,
                  borderRadius: HF.r.md,
                  padding: '8px 12px',
                }}
              >
                {t('banner.customize')}
              </button>
              <button
                type="button"
                data-testid="cookie-banner-reject-all"
                onClick={rejectAll}
                className="text-sm font-medium"
                style={{
                  background: HF.paper,
                  color: HF.ink,
                  border: `1px solid ${HF.borderHi}`,
                  borderRadius: HF.r.md,
                  padding: '8px 12px',
                }}
              >
                {t('banner.rejectAll')}
              </button>
              <button
                type="button"
                data-testid="cookie-banner-accept-all"
                onClick={acceptAll}
                className="text-sm font-semibold"
                style={{
                  background: HF.accent,
                  color: '#FFFFFF',
                  border: `1px solid ${HF.accent}`,
                  borderRadius: HF.r.md,
                  padding: '8px 12px',
                }}
              >
                {t('banner.acceptAll')}
              </button>
            </div>
          </div>
        </div>
      </div>
      <CookiePreferencesModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      />
    </>
  );
}
