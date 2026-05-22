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
import {
  stampV2WelcomeLetterDelivered,
  stampV2Hud9281FairHousingPosted,
} from "./v2-stamp";
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
    // BP-02 Lane G dual-write — gated on COMPLIANCE_TAPE_V2_ENABLED.
    // medium="web" since this beacon fires from the in-browser Welcome page.
    void stampV2Hud9281FairHousingPosted({
      sessionId: parsed.data.session_id,
      medium: "web",
      postedAt: new Date().toISOString(),
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
    // BP-02 Lane G dual-write — gated on COMPLIANCE_TAPE_V2_ENABLED.
    // Pre-auth beacon: email is the only identity available; the v2 chain
    // uses it as the applicantId proxy until the user verifies and lands
    // in `users`. Phase 3 will rebase on the verified users.id.
    if (parsed.data.email) {
      void stampV2WelcomeLetterDelivered({
        applicantId: parsed.data.email,
        deliveredAt: new Date().toISOString(),
        sessionId: parsed.data.session_id,
      });
    }
    res.status(204).end();
  } catch (err) {
    logger.error("welcome-accept beacon failed", { error: (err as Error).message });
    res.status(500).json({ error: "Beacon failed" });
  }
});

// BP-03b.1 Payment Wizard scaffold beacons.
// Frozen Contract 4:
//   POST /api/tape/payment-init    → bp03b.payment_initiated   (HUD 4350.3 Ch. 4-6)
//   POST /api/tape/payment-success → bp03b.payment_succeeded   (HUD 4350.3 Ch. 4-6)
// Both accept { session_id, adults, total } and are idempotent per (kind, session_id).
// BP-08 owns real Stripe wiring; this is scaffold-only.
const paymentBeaconSchema = z.object({
  session_id: z.string().min(1).max(128),
  // Coerce so the client can send numeric strings ("71.90") or numbers.
  // StepPayment passes state.paymentTotal which is a formatted decimal string;
  // future Stripe wiring may pass a number. Both must pass schema.
  adults: z.coerce.number().int().nonnegative().optional(),
  total: z.coerce.number().nonnegative().optional(),
});

function makePaymentBeacon(kindKey: "BP03B_PAYMENT_INITIATED" | "BP03B_PAYMENT_SUCCEEDED", label: string) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      // Reject early on missing or non-string session_id with explicit 400.
      if (!req.body || typeof req.body.session_id !== "string" || req.body.session_id.length === 0) {
        res.status(400).json({ error: "session_id is required" });
        return;
      }
      const parsed = paymentBeaconSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Validation failed" });
        return;
      }
      const record = await stampTape({
        kind: kindKey,
        actor: "tenant",
        payload: {
          adults: parsed.data.adults ?? null,
          total: parsed.data.total ?? null,
        },
        sessionId: parsed.data.session_id,
      });
      // Idempotent: stampTape returns null on dedupe hit; treat both as 200.
      res.status(200).json({
        ok: true,
        kind: TAPE_STAMP_KINDS[kindKey],
        session_id: parsed.data.session_id,
        idempotent: record === null,
      });
    } catch (err) {
      logger.error(`${label} beacon failed`, { error: (err as Error).message });
      res.status(500).json({ error: "Beacon failed" });
    }
  };
}

router.post("/payment-init", beaconLimiter, makePaymentBeacon("BP03B_PAYMENT_INITIATED", "payment-init"));
router.post("/payment-success", beaconLimiter, makePaymentBeacon("BP03B_PAYMENT_SUCCEEDED", "payment-success"));

export default router;
