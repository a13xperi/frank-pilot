import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import enCommon from './en/common.json';
import enWelcome from './en/welcome.json';
import enApply from './en/apply.json';
import enWaitlist from './en/waitlist.json';
import enDiscover from './en/discover.json';

import esCommon from './es/common.json';
import esWelcome from './es/welcome.json';
import esApply from './es/apply.json';
import esWaitlist from './es/waitlist.json';
import esDiscover from './es/discover.json';

export const NS = ['common', 'welcome', 'apply', 'waitlist', 'discover'] as const;

const resources = {
  en: {
    common: enCommon,
    welcome: enWelcome,
    apply: enApply,
    waitlist: enWaitlist,
    discover: enDiscover,
  },
  es: {
    common: esCommon,
    welcome: esWelcome,
    apply: esApply,
    waitlist: esWaitlist,
    discover: esDiscover,
  },
};

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
      caches: ['localStorage'],
    },
    returnNull: false,
  });

export default i18n;
