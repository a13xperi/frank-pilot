import { Router, Response } from "express";
import { z } from "zod";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { requireEmailVerified } from "../../middleware/scope";
import { query } from "../../config/database";
import { writeAuditLog } from "../../middleware/audit";
import { logger } from "../../utils/logger";
import { getStripe } from "../../lib/stripe";
import { stampTape } from "../tape";
import {
  buildIdempotencyKey,
  decide,
  insertPending,
  lookup,
} from "./idempotency";

/**
 * POST /api/payments/intents
 *
 * Mints (or returns the cached) Stripe PaymentIntent for an application's
 * payment attempt. Idempotent on `(applicationId, attemptN)`:
 *
 *   - First call for the key             → creates a PaymentIntent, persists a
 *                                          `pending` row, emits a
 *                                          `bp08.payment_intent_created` stamp,
 *                                          returns the client_secret.
 *
 *   - Repeat call before terminal status → returns the cached client_secret.
 *                                          No new stamp, no new Stripe call.
 *
 *   - Repeat call after success/failure  → 409 + `bp08.payment_replay_blocked`
 *                                          stamp. Client must bump attemptN.
 *
 * Scope: caller must be an applicant/tenant linked to the application via
 * `user_applications`. The staff-initiated payment path is not in scope for
 * this PR.
 */

const intentSchema = z.object({
  applicationId: z.string().uuid(),
  amountCents: z.number().int().positive().max(10_000_000),
  currency: z
    .string()
    .length(3)
    .transform((s) => s.toLowerCase())
    .optional(),
  attemptN: z.number().int().positive(),
});

async function callerOwnsApplication(
  userId: string,
  applicationId: string
): Promise<boolean> {
  const result = await query(
    `SELECT 1 FROM user_applications
      WHERE user_id = $1 AND application_id = $2
      LIMIT 1`,
    [userId, applicationId]
  );
  return result.rows.length > 0;
}

const router = Router();

router.post(
  "/",
  authenticate,
  requireEmailVerified,
  async (req: AuthRequest, res: Response): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    let input: z.infer<typeof intentSchema>;
    try {
      input = intentSchema.parse(req.body);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: "Validation failed", details: err.issues });
        return;
      }
      throw err;
    }

    const currency = input.currency ?? "usd";
    const { applicationId, amountCents, attemptN } = input;

    if (!["applicant", "tenant"].includes(req.user.role)) {
      res.status(403).json({ error: "Applicant or tenant role required" });
      return;
    }

    // 404, not 403: the ownership check fails identically whether the
    // application doesn't exist or exists but belongs to someone else.
    // Returning 403 only in the latter case would leak application-id
    // existence to an enumerating attacker. We collapse both into a single
    // "not found" response so the caller can't distinguish the two.
    if (!(await callerOwnsApplication(req.user.id, applicationId))) {
      res.status(404).json({ error: "application_not_found" });
      return;
    }

    const idempotencyKey = buildIdempotencyKey(applicationId, attemptN);
    const existing = await lookup(idempotencyKey);
    const decision = decide(existing);

    if (decision.kind === "replay") {
      await writeAuditLog({
        action: "payment_intent_replay",
        actorId: req.user.id,
        actorRole: req.user.role,
        applicationId,
        details: { attemptN, idempotencyKey },
      });
      res.json({
        clientSecret: decision.row.clientSecret,
        paymentIntentId: decision.row.paymentIntentId,
        idempotencyKey,
        replay: true,
      });
      return;
    }

    if (decision.kind === "blocked") {
      void stampTape({
        kind: "BP08_PAYMENT_REPLAY_BLOCKED",
        actor: req.user.id,
        sessionId: idempotencyKey,
        payload: {
          applicationId,
          attemptN,
          paymentIntentId: decision.row.paymentIntentId,
          reason: decision.reason,
        },
      });
      await writeAuditLog({
        action: "payment_intent_replay_blocked",
        actorId: req.user.id,
        actorRole: req.user.role,
        applicationId,
        details: { attemptN, idempotencyKey, reason: decision.reason },
      });
      res.status(409).json({
        error: "Payment attempt already in a terminal state — bump attemptN",
        paymentIntentId: decision.row.paymentIntentId,
        reason: decision.reason,
      });
      return;
    }

    // decision.kind === "create"
    try {
      const stripe = getStripe();
      const intent = await stripe.paymentIntents.create(
        {
          amount: amountCents,
          currency,
          metadata: {
            applicationId,
            attemptN: String(attemptN),
            actorId: req.user.id,
          },
        },
        { idempotencyKey }
      );

      if (!intent.client_secret) {
        throw new Error("Stripe returned PaymentIntent without client_secret");
      }

      await insertPending({
        idempotencyKey,
        applicationId,
        attemptN,
        amountCents,
        currency,
        paymentIntentId: intent.id,
        clientSecret: intent.client_secret,
      });

      void stampTape({
        kind: "BP08_PAYMENT_INTENT_CREATED",
        actor: req.user.id,
        sessionId: idempotencyKey,
        payload: {
          applicationId,
          attemptN,
          amountCents,
          currency,
          paymentIntentId: intent.id,
          idempotencyKey,
        },
      });

      await writeAuditLog({
        action: "payment_intent_created",
        actorId: req.user.id,
        actorRole: req.user.role,
        applicationId,
        resourceType: "payment_intent",
        resourceId: intent.id,
        details: { attemptN, amountCents, currency, idempotencyKey },
      });

      res.status(201).json({
        clientSecret: intent.client_secret,
        paymentIntentId: intent.id,
        idempotencyKey,
      });
    } catch (err) {
      logger.error("PaymentIntent create failed", {
        error: (err as Error).message,
        applicationId,
        attemptN,
      });
      res.status(502).json({ error: "Failed to create payment intent" });
    }
  }
);

export default router;
