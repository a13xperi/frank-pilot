import { Router } from "express";
import { z } from "zod";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { createMagicLink, verifyMagicLink, logMagicLink } from "./magic-link-service";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { verifyTurnstile } from "../../middleware/verify-turnstile";
import { logger } from "../../utils/logger";
import { shouldReturnDevLink } from "../../utils/demo-link";

const router: Router = Router();

const requestSchema = z.object({
  email: z.string().email(),
  // wedge #13: Turnstile widget response. Optional in the schema because
  // dev/test bypass the middleware entirely; production gates rejection
  // inside verify-turnstile (403 turnstile_verification_failed).
  turnstileToken: z.string().optional(),
});

// Per (ip, email) limit — 5/min — keeps the existing tight bucket so a single
// attacker can't flood one inbox.
const magicLinkLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? "")}:${(req.body?.email ?? "").toLowerCase()}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, try again in a minute" },
});

// wedge #13: per-IP bucket on top of the per-(ip,email) one. The existing
// limiter is keyed on email too, so a botnet from one IP that cycles email
// addresses defeats it (every key is fresh). 30/min/IP is generous for legit
// users on shared NATs but stops a single source from blasting many inboxes.
const magicLinkIpLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ""),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, try again in a minute" },
});

router.post(
  "/magic-link/request",
  magicLinkIpLimiter,
  magicLinkLimiter,
  verifyTurnstile(),
  async (req, res) => {
    try {
      const parsed = requestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Valid email required" });
        return;
      }

      const result = await createMagicLink(parsed.data.email);

      // Always respond with success — don't leak which emails exist.
      if (result) {
        logMagicLink(parsed.data.email, result.link);
        // Surface the link in the response only when the demo-link gate opens
        // (dev, or a matching x-demo-token under DEMO_LINK_SECRET). This is the
        // returning-user counterpart to /applicants/register's devLink echo, so
        // usability testers can log back in without a working inbox. Closed by
        // default on a tenant-facing deploy (WARN #3 stays satisfied).
        if (shouldReturnDevLink(req)) {
          res.json({ ok: true, devLink: result.link });
          return;
        }
      }
      res.json({ ok: true });
    } catch (err) {
      logger.error("Magic-link request failed", { error: (err as Error).message });
      res.status(500).json({ error: "Failed to send link" });
    }
  }
);

const verifySchema = z.object({
  token: z.string().min(20),
});

router.post("/magic-link/verify", async (req, res) => {
  try {
    const parsed = verifySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Token required" });
      return;
    }

    const result = await verifyMagicLink(parsed.data.token);
    if (!result) {
      res.status(401).json({ error: "Invalid or expired link" });
      return;
    }
    res.json(result);
  } catch (err) {
    logger.error("Magic-link verify failed", { error: (err as Error).message });
    res.status(500).json({ error: "Verification failed" });
  }
});

// WARN #2: lightweight self-check so the client can poll for verification
// status during the post-register "check your email" stage. Returns the
// resolved AuthUser from authenticate() — which reads email_verified_at
// from the DB on every call, so verification status is always live.
router.get("/me", authenticate, (req: AuthRequest, res) => {
  res.json({ user: req.user });
});

export default router;
