/**
 * Local i18n stub — Lane B (welcome) ships before Lane A wires react-i18next.
 *
 * API surface mirrors `react-i18next`'s `useTranslation(ns)` so that on merge
 * with Lane A, we can change the import line to:
 *   `import { useTranslation } from 'react-i18next';`
 * and delete this file with no other changes.
 *
 * Language is read from `?lng=` in the URL (defaults to `en`). Translations
 * are loaded synchronously from JSON files in this same directory.
 */
import enWelcome from './en/welcome.json';
import esWelcome from './es/welcome.json';

const BUNDLES: Record<string, Record<string, any>> = {
  en: { welcome: enWelcome },
  es: { welcome: esWelcome },
};

function detectLang(): 'en' | 'es' {
  if (typeof window === 'undefined') return 'en';
  const url = new URL(window.location.href);
  const lng = url.searchParams.get('lng');
  if (lng === 'es') return 'es';
  return 'en';
}

function lookup(bundle: any, key: string): string | undefined {
  return key.split('.').reduce((acc: any, part) => (acc == null ? undefined : acc[part]), bundle);
}

export function useTranslation(ns: string = 'welcome') {
  const lang = detectLang();
  const bundle = BUNDLES[lang]?.[ns] ?? BUNDLES.en[ns];
  const t = (key: string, fallback?: string): string => {
    // Allow `welcome.foo.bar` or `foo.bar` (with ns prefix stripped).
    const stripped = key.startsWith(`${ns}.`) ? key.slice(ns.length + 1) : key;
    const v = lookup(bundle, stripped) ?? lookup(BUNDLES.en[ns], stripped);
    return (typeof v === 'string' ? v : fallback ?? key);
  };
  return { t, i18n: { language: lang } };
}
