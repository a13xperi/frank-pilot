/**
 * Cloudflare Turnstile verification middleware (gpmglv wedge #13 — anti-spam).
 *
 * gpmglv.com's waitlist + contact forms have NO visible captcha (audit
 * §Per-Page Dumps). This middleware closes that gap on our public POST
 * surfaces (register, magic-link/request). Order in the route chain:
 *
 *   rate-limit  →  verify-turnstile  →  handler
 *
 * Dev/test bypass: when `TURNSTILE_SECRET_KEY` is unset, empty, or equals
 * Cloudflare's well-known dev secret `1x0000000000000000000000000000000AA`,
 * the middleware passes through without calling siteverify. This keeps the
 * Welcome→Claim smoke green (CI doesn't have a real key) and lets every test
 * skip the captcha without mocking fetch. Set a real secret in prod.
 *
 * On failure: 403 { error: 'turnstile_verification_failed' }.
 *
 * Why a config token field rather than always reading `req.body.turnstileToken`:
 * future forms might pass the widget response under a different name (e.g.
 * `cf-turnstile-response` direct from the Turnstile widget DOM). Keep this
 * flexible at the middleware factory level so callers can wire either shape.
 */
import { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger";

const TURNSTILE_DEV_SECRET = "1x0000000000000000000000000000000AA";
const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export interface VerifyTurnstileOptions {
  /** Body field that holds the widget response token. Default: `turnstileToken`. */
  tokenField?: string;
  /**
   * Override fetch implementation — primarily for tests. Defaults to global
   * `fetch` (Node 18+).
   */
  fetchImpl?: typeof fetch;
}

interface TurnstileResponse {
  success: boolean;
  "error-codes"?: string[];
  challenge_ts?: string;
  hostname?: string;
  action?: string;
  cdata?: string;
}

/**
 * Returns true if the current environment configuration means "skip the
 * remote siteverify call and just pass." Centralized so the same predicate
 * drives both the route-level bypass and the test assertions.
 */
export function isTurnstileBypassed(): boolean {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret || secret.trim() === "") return true;
  if (secret === TURNSTILE_DEV_SECRET) return true;
  return false;
}

export function verifyTurnstile(options: VerifyTurnstileOptions = {}) {
  const tokenField = options.tokenField ?? "turnstileToken";
  // Resolve fetch lazily so tests that set globalThis.fetch after import
  // still see their mock. Without this, capturing `fetch` at module-load
  // pins the value before vi.stubGlobal/jest.spyOn runs.
  const getFetch = (): typeof fetch =>
    options.fetchImpl ?? (globalThis.fetch as typeof fetch);

  return async function turnstileMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    if (isTurnstileBypassed()) {
      next();
      return;
    }

    const token =
      typeof req.body?.[tokenField] === "string"
        ? (req.body[tokenField] as string)
        : "";
    if (!token) {
      res.status(403).json({ error: "turnstile_verification_failed" });
      return;
    }

    try {
      const fetchFn = getFetch();
      const form = new URLSearchParams();
      form.append("secret", process.env.TURNSTILE_SECRET_KEY as string);
      form.append("response", token);
      // remoteip is optional but recommended — Cloudflare uses it for risk
      // scoring. Empty string is fine when behind layered proxies.
      form.append("remoteip", req.ip ?? "");

      const cfRes = await fetchFn(SITEVERIFY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      });

      if (!cfRes.ok) {
        logger.warn("Turnstile siteverify non-2xx", { status: cfRes.status });
        res.status(403).json({ error: "turnstile_verification_failed" });
        return;
      }

      const body = (await cfRes.json()) as TurnstileResponse;
      if (!body.success) {
        logger.warn("Turnstile verification rejected", {
          errors: body["error-codes"],
        });
        res.status(403).json({ error: "turnstile_verification_failed" });
        return;
      }

      next();
    } catch (err) {
      // Fail closed: any siteverify outage shouldn't silently let signups
      // through. Operators can flip TURNSTILE_SECRET_KEY to the dev sentinel
      // to disable the check during an incident.
      logger.error("Turnstile siteverify error", {
        error: (err as Error).message,
      });
      res.status(403).json({ error: "turnstile_verification_failed" });
    }
  };
}

export const TURNSTILE_DEV_SECRET_KEY = TURNSTILE_DEV_SECRET;
