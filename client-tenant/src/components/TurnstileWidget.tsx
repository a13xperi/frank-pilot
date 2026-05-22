/**
 * Cloudflare Turnstile widget (gpmglv wedge #13 — anti-spam).
 *
 * gpmglv.com's public forms have no captcha. We mount this on our register +
 * magic-link forms to gate bot signups. The widget is rendered lazily — the
 * Turnstile script is appended to <head> via a React effect on first mount
 * of this component. This is intentional: wedge #14 (SEO indexing) is editing
 * `index.html` in parallel; modifying the document head from a component
 * keeps these two wedges from colliding.
 *
 * Dev/test bypass: when VITE_TURNSTILE_SITE_KEY is unset OR equals the
 * Cloudflare well-known test key `1x00000000000000000000AA`, the widget
 * skips the real Turnstile flow and synchronously schedules `onVerify` with
 * the sentinel string `test-token-dev`. This is critical for the Welcome →
 * Claim e2e smoke (CI doesn't have a real site key) and for unit tests.
 *
 * The bypass token is paired with the server-side dev secret
 * `1x0000000000000000000000000000000AA`, which the verify-turnstile
 * middleware also short-circuits on. So in dev: widget ships `test-token-dev`,
 * server skips siteverify, smoke stays green. In prod: real key, real secret,
 * full verification.
 */
import { useEffect, useRef } from "react";

const DEV_SITE_KEY = "1x00000000000000000000AA";
const TURNSTILE_SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        params: {
          sitekey: string;
          callback?: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
          theme?: "light" | "dark" | "auto";
          size?: "normal" | "compact" | "flexible";
        }
      ) => string;
      remove?: (widgetId: string) => void;
      reset?: (widgetId?: string) => void;
    };
  }
}

export interface TurnstileWidgetProps {
  /**
   * Cloudflare site key. Defaults to `VITE_TURNSTILE_SITE_KEY` from env.
   * If unset, empty, or matches Cloudflare's dev test key, the widget runs
   * in bypass mode (auto-fires `onVerify('test-token-dev')`).
   */
  siteKey?: string;
  onVerify: (token: string) => void;
  onExpire?: () => void;
  onError?: () => void;
  /** Optional theme — Cloudflare default is `auto`. */
  theme?: "light" | "dark" | "auto";
  /** Optional size — `flexible` recommended for narrow forms. */
  size?: "normal" | "compact" | "flexible";
  /**
   * Test seam — let tests assert bypass behaviour without futzing with
   * import.meta.env. Defaults to reading the env var.
   */
  forceBypassForTests?: boolean;
}

function resolveSiteKey(propKey?: string): string {
  if (propKey && propKey.trim() !== "") return propKey;
  // import.meta.env is statically rewritten by Vite at build time — guard
  // for SSR/test environments where it may be undefined.
  const envKey =
    (typeof import.meta !== "undefined" &&
      (import.meta as ImportMeta & { env?: Record<string, string> }).env
        ?.VITE_TURNSTILE_SITE_KEY) ||
    "";
  return envKey;
}

export function isTurnstileBypass(siteKey: string): boolean {
  if (!siteKey || siteKey.trim() === "") return true;
  if (siteKey === DEV_SITE_KEY) return true;
  return false;
}

function ensureTurnstileScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.turnstile) return Promise.resolve();

  const existing = document.querySelector<HTMLScriptElement>(
    `script[src^="${TURNSTILE_SCRIPT_SRC.split("?")[0]}"]`
  );
  if (existing) {
    if (window.turnstile) return Promise.resolve();
    return new Promise((resolve) => {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => resolve(), { once: true });
    });
  }

  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    // Resolve even on load error so the form isn't permanently stuck. The
    // submit handler still gates on a non-empty token, so a failed load
    // means the user can't submit — which is the desired fail-closed mode.
    script.onerror = () => resolve();
    document.head.appendChild(script);
  });
}

export function TurnstileWidget({
  siteKey,
  onVerify,
  onExpire,
  onError,
  theme = "auto",
  size = "flexible",
  forceBypassForTests,
}: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  // Refs keep the latest callbacks accessible inside the async render
  // without re-mounting the widget every time a parent re-renders. Turnstile
  // mount is expensive and the widget keeps internal state we don't want to
  // throw away on each parent state tick.
  const onVerifyRef = useRef(onVerify);
  const onExpireRef = useRef(onExpire);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onVerifyRef.current = onVerify;
    onExpireRef.current = onExpire;
    onErrorRef.current = onError;
  }, [onVerify, onExpire, onError]);

  const resolvedKey = resolveSiteKey(siteKey);
  const bypass = forceBypassForTests || isTurnstileBypass(resolvedKey);

  useEffect(() => {
    if (bypass) {
      // Fire bypass token on next tick so callers wiring `onVerify` in the
      // same render pass see it after their state hooks settle. The smoke
      // test waits >1s before clicking Continue, so this lands well before.
      const id = setTimeout(() => {
        onVerifyRef.current("test-token-dev");
      }, 0);
      return () => clearTimeout(id);
    }

    let cancelled = false;
    void (async () => {
      await ensureTurnstileScript();
      if (cancelled) return;
      if (!window.turnstile || !containerRef.current) return;

      try {
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: resolvedKey,
          theme,
          size,
          callback: (token: string) => onVerifyRef.current(token),
          "expired-callback": () => onExpireRef.current?.(),
          "error-callback": () => onErrorRef.current?.(),
        });
      } catch {
        onErrorRef.current?.();
      }
    })();

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile?.remove) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          /* widget may already be torn down */
        }
        widgetIdRef.current = null;
      }
    };
  }, [bypass, resolvedKey, theme, size]);

  // Bypass mode renders nothing visible — the smoke test selects the
  // continue CTA by text and doesn't expect a captcha block to appear.
  if (bypass) return null;

  return (
    <div
      ref={containerRef}
      data-testid="turnstile-widget"
      aria-label="Captcha verification"
    />
  );
}

export default TurnstileWidget;
