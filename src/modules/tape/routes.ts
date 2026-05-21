/**
 * Public-ish tape beacons for BP-03b client touchpoints that have no other
 * server-side hook (e.g. Welcome page-view fires the HUD-928.1 stamp).
 *
 * Idempotent per `session_id` — repeated calls within the same process for
 * the same kind+session are no-ops at the ledger layer.
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { stampTape, TAPE_STAMP_KINDS } from "./index";
import { logger } from "../../utils/logger";

const router: Router = Router();

const beaconLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ""),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests" },
});

const welcomeBeaconSchema = z.object({
  session_id: z.string().min(8).max(128),
  state: z.string().max(40).optional(),
  property_slug: z.string().max(120).optional(),
});

// POST /api/tape/welcome-view
// Fires HUD_928_1_FAIR_HOUSING_POSTED. Idempotent per (kind, session_id).
router.post("/welcome-view", beaconLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = welcomeBeaconSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed" });
      return;
    }
    await stampTape({
      kind: TAPE_STAMP_KINDS.HUD_928_1_FAIR_HOUSING_POSTED,
      actor: null, // public, pre-auth
      payload: {
        state: parsed.data.state ?? null,
        property_slug: parsed.data.property_slug ?? null,
      },
      sessionId: parsed.data.session_id,
    });
    res.status(204).end();
  } catch (err) {
    logger.error("welcome-view beacon failed", { error: (err as Error).message });
    res.status(500).json({ error: "Beacon failed" });
  }
});

// POST /api/tape/welcome-accept  (fallback for Lane B; Lane B may also wire it inline)
const acceptBeaconSchema = z.object({
  session_id: z.string().min(8).max(128),
  email: z.string().email().optional(),
  property_slug: z.string().max(120).optional(),
});

router.post("/welcome-accept", beaconLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = acceptBeaconSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed" });
      return;
    }
    await stampTape({
      kind: TAPE_STAMP_KINDS.WELCOME_LETTER_DELIVERED,
      actor: parsed.data.email ?? null,
      payload: {
        email: parsed.data.email ?? null,
        property_slug: parsed.data.property_slug ?? null,
      },
      sessionId: parsed.data.session_id,
    });
    res.status(204).end();
  } catch (err) {
    logger.error("welcome-accept beacon failed", { error: (err as Error).message });
    res.status(500).json({ error: "Beacon failed" });
  }
});

export default router;
