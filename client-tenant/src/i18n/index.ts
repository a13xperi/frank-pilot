/**
 * Lane E minimal i18n shim — replace with `react-i18next` provider when
 * Lane A's BP-00 substrate lands. Same key shape as the production
 * `useTranslation` hook so swap-out is mechanical.
 *
 * Language is picked from `?lng=es` query string, then `localStorage.lng`,
 * then navigator language, defaulting to `en`.
 */
import en_waitlist from "./en/waitlist.json";
import es_waitlist from "./es/waitlist.json";

type Dict = Record<string, unknown>;
const BUNDLES: Record<string, Record<string, Dict>> = {
  en: { waitlist: en_waitlist as Dict },
  es: { waitlist: es_waitlist as Dict },
};

function detectLang(): "en" | "es" {
  if (typeof window === "undefined") return "en";
  const url = new URL(window.location.href);
  const q = url.searchParams.get("lng");
  if (q === "es" || q === "en") {
    try { localStorage.setItem("lng", q); } catch { /* ignore */ }
    return q;
  }
  try {
    const stored = localStorage.getItem("lng");
    if (stored === "es" || stored === "en") return stored;
  } catch { /* ignore */ }
  const nav = (navigator.language || "en").slice(0, 2).toLowerCase();
  return nav === "es" ? "es" : "en";
}

function lookup(dict: Dict, path: string): string | undefined {
  const parts = path.split(".");
  let node: unknown = dict;
  for (const p of parts) {
    if (node && typeof node === "object" && p in (node as Dict)) {
      node = (node as Dict)[p];
    } else {
      return undefined;
    }
  }
  return typeof node === "string" ? node : undefined;
}

function interpolate(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s;
  return s.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in vars ? String(vars[k]) : `{{${k}}}`));
}

export function useT(namespace: "waitlist") {
  const lang = detectLang();
  return (key: string, vars?: Record<string, string | number>): string => {
    const bundle = BUNDLES[lang]?.[namespace] ?? BUNDLES.en[namespace];
    const fallback = BUNDLES.en[namespace];
    const value = lookup(bundle, key) ?? lookup(fallback, key) ?? key;
    return interpolate(value, vars);
  };
}

export function currentLang(): "en" | "es" {
  return detectLang();
}
