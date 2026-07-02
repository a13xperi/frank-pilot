import rateLimit, { ipKeyGenerator } from "express-rate-limit";

/**
 * Staff password-login rate limiters (audit #7b: carried-over P0). Staff
 * accounts hold the PII-bearing PM roles, so brute-force + user-enumeration
 * on /api/auth/login is the soft spot (the tenant magic-link is already
 * limited). Two buckets: per-(IP,email) stops a targeted guess stream; the
 * wider per-IP bucket stops one host spraying many accounts.
 *
 * Enforced in PRODUCTION only — dev/CI (incl. the pm-console Playwright E2E
 * that logs in repeatedly) bypasses so it isn't throttled. `skip` reads
 * NODE_ENV per REQUEST, which is what lets the jest 429 test flip it inside
 * a single test body.
 *
 * Extracted from src/index.ts so the mounted route and the jest suite
 * exercise the SAME limiter instances/config rather than a test-local copy.
 */
const skipNonProd = (): boolean => process.env.NODE_ENV !== "production";

export const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  keyGenerator: (req) =>
    `${ipKeyGenerator(req.ip ?? "")}:${(req.body?.email ?? "").toLowerCase()}`,
  skip: skipNonProd,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts, try again in a minute" },
});

export const loginIpLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ""),
  skip: skipNonProd,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts, try again in a minute" },
});
