import { Router, Request, Response } from "express";

/**
 * GET /api/payments/config
 *
 * Returns the **publishable** Stripe key + the live-mode flag. Publishable
 * keys are safe to ship to browsers (Stripe's whole tokenization story
 * assumes this); we expose them via a server route rather than baking them
 * into the client bundle so a rotation only requires a server-env flip.
 *
 *   { publishableKey: string | null, enabled: boolean }
 *
 * `enabled=false` is the contract for the existing PaymentService stub mode:
 * the client wizard (PR #2) branches on this and stays in the no-Stripe path
 * until ops flip STRIPE_LIVE_ENABLED=true on Railway (gated by spec §8.1).
 *
 * This route is public — no auth — because the client needs it before the
 * user is logged in (to decide whether to even render Stripe UI).
 */

const router = Router();

router.get("/", (_req: Request, res: Response): void => {
  res.json({
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? null,
    enabled: process.env.STRIPE_LIVE_ENABLED === "true",
  });
});

export default router;
