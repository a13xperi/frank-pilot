// Minimal i18n shim — Lane A's canonical i18n setup (react-i18next) will replace.
// Contract: `useTranslation(ns)` returns `{ t: (key) => string }`.
//
// Language selection: localStorage['frank_locale'] ∈ {'en', 'es'} → default 'en'.
// JSON files under src/i18n/{en,es}/<ns>.json are statically imported here.

import enDiscover from './en/discover.json';
import esDiscover from './es/discover.json';

type Bundle = Record<string, Record<string, string>>;

const bundles: Record<string, Bundle> = {
  en: { discover: enDiscover },
  es: { discover: esDiscover },
};

export function getLocale(): 'en' | 'es' {
  if (typeof window === 'undefined') return 'en';
  const l = window.localStorage?.getItem('frank_locale');
  return l === 'es' ? 'es' : 'en';
}

function lookup(ns: string, key: string): string {
  const locale = getLocale();
  const bundle = bundles[locale]?.[ns] ?? bundles.en[ns];
  if (!bundle) return key;
  // dot-path lookup (one level deep)
  if (key in bundle) return bundle[key];
  const parts = key.split('.');
  let cur: unknown = bundle;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return key;
    }
  }
  return typeof cur === 'string' ? cur : key;
}

export function useTranslation(ns: string) {
  return {
    t: (key: string, vars?: Record<string, string | number>) => {
      let out = lookup(ns, key);
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          out = out.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v));
        }
      }
      return out;
    },
  };
}
