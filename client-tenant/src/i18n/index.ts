import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { getConsentSnapshot } from '@/state/consent';

import enCommon from './en/common.json';
import enWelcome from './en/welcome.json';
import enApply from './en/apply.json';
import enWaitlist from './en/waitlist.json';
import enDiscover from './en/discover.json';
import enLegal from './en/legal.json';
import enSettings from './en/settings.json';
import enLease from './en/lease.json';

import esCommon from './es/common.json';
import esWelcome from './es/welcome.json';
import esApply from './es/apply.json';
import esWaitlist from './es/waitlist.json';
import esDiscover from './es/discover.json';
import esLegal from './es/legal.json';
import esSettings from './es/settings.json';
import esLease from './es/lease.json';

export const NS = ['common', 'welcome', 'apply', 'waitlist', 'discover', 'legal', 'settings', 'lease'] as const;

const resources = {
  en: {
    common: enCommon,
    welcome: enWelcome,
    apply: enApply,
    waitlist: enWaitlist,
    discover: enDiscover,
    legal: enLegal,
    settings: enSettings,
    lease: enLease,
  },
  es: {
    common: esCommon,
    welcome: esWelcome,
    apply: esApply,
    waitlist: esWaitlist,
    discover: esDiscover,
    legal: esLegal,
    settings: esSettings,
    lease: esLease,
  },
};

// Language preference (i18nextLng) is "functional" storage under GDPR.
// If the user has not yet granted Functional consent (either undefined or
// explicitly false), we don't persist the choice — language resets each
// reload until they opt in. This is the one real consequence the consent
// store gates today; everything else is plumbing for the future.
function functionalConsentGranted(): boolean {
  try {
    return getConsentSnapshot().functional === true;
  } catch {
    return false;
  }
}

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    supportedLngs: ['en', 'es'],
    defaultNS: 'common',
    ns: NS as unknown as string[],
    interpolation: { escapeValue: false },
    detection: {
      order: ['querystring', 'localStorage', 'navigator'],
      lookupQuerystring: 'lng',
      lookupLocalStorage: 'i18nextLng',
      caches: functionalConsentGranted() ? ['localStorage'] : [],
    },
    returnNull: false,
  });

// If a previous session persisted i18nextLng but the user hasn't (yet)
// granted Functional consent, clear the cached preference so the choice
// doesn't survive without consent. We re-write it lazily once they accept.
if (!functionalConsentGranted()) {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('i18nextLng');
    }
  } catch {
    /* best-effort */
  }
}

export default i18n;
