/**
 * Public privacy policy — plain language, accurate to what the codebase
 * actually does today (Resend for email, Stripe for payments, Postgres
 * hosted on Railway during the pilot, no analytics, no marketing pixels).
 *
 * Wedge #15: gpmglv.com competitor ships a thin policy. We ship one
 * that names the HUD / FCRA obligations and itemises every third party.
 */

import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { HF } from '@/styles/tokens';

const SECTION_KEYS = [
  'whatWeCollect',
  'whyWeCollect',
  'whoWeShareWith',
  'retention',
  'yourRights',
  'contact',
] as const;

export function PrivacyPolicy() {
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
            {t('privacy.title')}
          </h1>
          <p className="mt-1 text-xs" style={{ color: HF.ink3 }}>
            {t('privacy.lastUpdated')}
          </p>
        </header>

        <p style={{ color: HF.ink2 }}>{t('privacy.intro')}</p>

        {SECTION_KEYS.map((k) => (
          <section key={k} className="mt-6">
            <h2
              className="text-lg font-semibold"
              style={{ fontFamily: HF.display, color: HF.ink }}
            >
              {t(`privacy.sections.${k}.title`)}
            </h2>
            <p className="mt-1" style={{ color: HF.ink2 }}>
              {t(`privacy.sections.${k}.body`)}
            </p>
          </section>
        ))}

        <footer className="mt-10 text-xs" style={{ color: HF.ink3 }}>
          <Link
            to="/cookies"
            style={{ color: HF.accent, textDecoration: 'underline' }}
          >
            Cookies policy
          </Link>
        </footer>
      </article>
    </div>
  );
}
