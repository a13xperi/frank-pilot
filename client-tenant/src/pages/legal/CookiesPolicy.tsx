/**
 * Public cookies policy — categorised list of every cookie or
 * browser-storage entry Frank Pilot uses today. Itemised in
 * i18n (en/es) legal.json so it stays accurate and translatable.
 *
 * Wedge #15.
 */

import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { HF } from '@/styles/tokens';

const CATEGORY_KEYS = [
  'essential',
  'functional',
  'analytics',
  'marketing',
] as const;

interface CookieItem {
  name: string;
  purpose: string;
  type: string;
}

export function CookiesPolicy() {
  const { t } = useTranslation('legal');

  return (
    <div
      className="min-h-screen"
      style={{ background: HF.cream, color: HF.ink, fontFamily: HF.body }}
    >
      <article
        className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-12"
        style={{ lineHeight: 1.6 }}
      >
        <header className="mb-6">
          <Link
            to="/welcome"
            className="text-sm"
            style={{ color: HF.accent, textDecoration: 'underline' }}
          >
            ← Frank Pilot
          </Link>
          <h1
            className="mt-3 text-2xl font-semibold sm:text-3xl"
            style={{ fontFamily: HF.display, color: HF.ink }}
          >
            {t('cookies.title')}
          </h1>
          <p className="mt-1 text-xs" style={{ color: HF.ink3 }}>
            {t('cookies.lastUpdated')}
          </p>
        </header>

        <p style={{ color: HF.ink2 }}>{t('cookies.intro')}</p>

        {CATEGORY_KEYS.map((key) => {
          const items = t(`cookies.categories.${key}.items`, {
            returnObjects: true,
          }) as CookieItem[] | undefined;
          const safeItems = Array.isArray(items) ? items : [];

          return (
            <section key={key} className="mt-6">
              <h2
                className="text-lg font-semibold"
                style={{ fontFamily: HF.display, color: HF.ink }}
              >
                {t(`cookies.categories.${key}.title`)}
              </h2>
              <p className="mt-1 text-sm" style={{ color: HF.ink2 }}>
                {t(`cookies.categories.${key}.description`)}
              </p>

              {safeItems.length > 0 && (
                <ul
                  className="mt-3 space-y-2"
                  style={{
                    border: `1px solid ${HF.border}`,
                    borderRadius: HF.r.md,
                    background: HF.paperHi,
                    padding: 12,
                  }}
                >
                  {safeItems.map((item) => (
                    <li
                      key={item.name}
                      className="text-xs sm:text-sm"
                      style={{ color: HF.ink2 }}
                    >
                      <div
                        className="font-mono font-semibold"
                        style={{ color: HF.ink, fontFamily: HF.mono }}
                      >
                        {item.name}
                      </div>
                      <div className="mt-0.5">
                        <span className="font-medium" style={{ color: HF.ink2 }}>
                          {t('cookies.tableHeaders.purpose')}:
                        </span>{' '}
                        {item.purpose}
                      </div>
                      <div>
                        <span className="font-medium" style={{ color: HF.ink2 }}>
                          {t('cookies.tableHeaders.type')}:
                        </span>{' '}
                        {item.type}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}

        <p
          className="mt-8 text-xs"
          style={{ color: HF.ink3, fontStyle: 'italic' }}
        >
          {t('cookies.managePreferences')}
        </p>

        <footer className="mt-6 text-xs" style={{ color: HF.ink3 }}>
          <Link
            to="/privacy"
            style={{ color: HF.accent, textDecoration: 'underline' }}
          >
            Privacy policy
          </Link>
        </footer>
      </article>
    </div>
  );
}
