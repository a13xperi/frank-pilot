// Lightweight i18n shim. Lane A will replace with react-i18next.
// Same call signature: const { t } = useTranslation('apply'); t('key.path').
import en from './en/apply.json';
import es from './es/apply.json';

const dictionaries: Record<string, Record<string, unknown>> = {
  en: { apply: en },
  es: { apply: es },
};

function detectLang(): 'en' | 'es' {
  if (typeof window === 'undefined') return 'en';
  const url = new URLSearchParams(window.location.search);
  let stored: string | null = null;
  try { stored = localStorage?.getItem?.('lng') ?? null; } catch { /* jsdom edge case */ }
  const lng = url.get('lng') || stored || navigator.language;
  return lng?.toLowerCase().startsWith('es') ? 'es' : 'en';
}

function lookup(dict: Record<string, unknown>, path: string): string | undefined {
  const parts = path.split('.');
  let cur: unknown = dict;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else return undefined;
  }
  return typeof cur === 'string' ? cur : undefined;
}

export function useTranslation(ns: string = 'apply') {
  const lang = detectLang();
  const t = (key: string, fallback?: string): string => {
    const dict = dictionaries[lang]?.[ns] as Record<string, unknown> | undefined;
    const enDict = dictionaries.en[ns] as Record<string, unknown>;
    return (
      (dict && lookup(dict, key)) ??
      lookup(enDict, key) ??
      fallback ??
      key
    );
  };
  return { t, i18n: { language: lang } };
}
