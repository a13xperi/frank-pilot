import { Router } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { createMagicLink, verifyMagicLink, logMagicLink } from "./magic-link-service";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { logger } from "../../utils/logger";

const router: Router = Router();

const requestSchema = z.object({
  email: z.string().email(),
});

const magicLinkLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  keyGenerator: (req) => `${req.ip}:${(req.body?.email ?? "").toLowerCase()}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, try again in a minute" },
});

router.post("/magic-link/request", magicLinkLimiter, async (req, res) => {
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
      // In dev, surface the link in the response so it's clickable for demos.
      if (process.env.NODE_ENV !== "production") {
        res.json({ ok: true, devLink: result.link });
        return;
      }
    }
    res.json({ ok: true });
  } catch (err) {
    logger.error("Magic-link request failed", { error: (err as Error).message });
    res.status(500).json({ error: "Failed to send link" });
  }
});

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
