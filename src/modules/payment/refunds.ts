import { Router, Response } from "express";
import { z } from "zod";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { requirePermission } from "../../middleware/rbac";
import { query } from "../../config/database";
import { writeAuditLog } from "../../middleware/audit";
import { logger } from "../../utils/logger";
import { getStripe } from "../../lib/stripe";
import { stampTape } from "../tape";

/**
 * POST /api/payments/refunds
 *
 * Staff-initiated refund REQUEST. Mirrors the succeeded-payment split: this
 * route only asks Stripe to refund — the `charge.refunded` webhook is the
 * source of truth that CONFIRMS the refund and posts the offsetting ledger
 * entry. We deliberately do NOT write to the ledger synchronously here; doing
 * so would double-post when the webhook lands, and would lie about a refund
 * Stripe might still decline.
 *
 * Gate: `ledger:manage` (same as the ledger reverse route). Applicants/tenants
 * cannot refund themselves.
 *
 * Idempotency: Stripe dedups the refund itself when we pass an idempotency key
 * derived from the PaymentIntent; the webhook dedups the ledger post on the
 * event id. We also stamp the refund id onto `payment_idempotency` for audit.
 */

const refundSchema = z.object({
  paymentIntentId: z.string().min(1),
  // Omit for a full refund; provide to refund part of the charge.
  amountCents: z.number().int().positive().max(10_000_000).optional(),
  reason: z.string().max(500).optional(),
});

interface OriginalPayment {
  applicationId: string;
  amountCents: number | null;
  currency: string | null;
  status: string;
}

async function lookupOriginalPayment(
  paymentIntentId: string
): Promise<OriginalPayment | null> {
  const result = await query(
    `SELECT application_id, amount_cents, currency, status
       FROM payment_idempotency
      WHERE payment_intent_id = $1
      ORDER BY created_at DESC
      LIMIT 1`,
    [paymentIntentId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    applicationId: row.application_id as string,
    amountCents: (row.amount_cents as number | null) ?? null,
    currency: (row.currency as string | null) ?? null,
    status: row.status as string,
  };
}

const router = Router();

router.post(
  "/",
  authenticate,
  requirePermission("ledger:manage"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = refundSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }
    const { paymentIntentId, amountCents, reason } = parsed.data;

    const original = await lookupOriginalPayment(paymentIntentId);
    if (!original) {
      res.status(404).json({ error: "No payment found for that PaymentIntent" });
      return;
    }
    if (original.status !== "succeeded") {
      res.status(409).json({ error: `Cannot refund a payment in '${original.status}' state` });
      return;
    }
    if (amountCents != null && original.amountCents != null && amountCents > original.amountCents) {
      res.status(400).json({ error: "Refund amount exceeds the original payment" });
      return;
    }

    let refundId: string;
    let refundStatus: string | null;
    try {
      const stripe = getStripe();
      const refund = await stripe.refunds.create(
        {
          payment_intent: paymentIntentId,
          ...(amountCents != null ? { amount: amountCents } : {}),
          // Stripe's `reason` is a fixed enum; our free-text reason rides in
          // metadata so staff notes survive without tripping enum validation.
          reason: "requested_by_customer",
          metadata: {
            applicationId: original.applicationId,
            actorId: req.user!.id,
            ...(reason ? { staffReason: reason } : {}),
          },
        },
        // PaymentIntent-scoped idempotency: a double-submit of the same full
        // refund request collapses to one Stripe refund.
        { idempotencyKey: `refund:${paymentIntentId}:${amountCents ?? "full"}` }
      );
      refundId = refund.id;
      refundStatus = refund.status ?? null;
    } catch (err) {
      logger.error("Stripe refund creation failed", {
        paymentIntentId,
        error: (err as Error).message,
      });
      res.status(502).json({ error: "Refund could not be created with the payment processor" });
      return;
    }

    // Stamp the refund onto the idempotency row for observability. The webhook
    // flips refund_status to its terminal value when it posts the ledger entry.
    await query(
      `UPDATE payment_idempotency
          SET refund_id = $2,
              refunded_amount_cents = $3,
              refund_status = COALESCE($4, refund_status, 'pending')
        WHERE payment_intent_id = $1`,
      [paymentIntentId, refundId, amountCents ?? original.amountCents ?? null, refundStatus]
    );

    await writeAuditLog({
      action: "payment_refund_requested",
      actorId: req.user!.id,
      actorRole: req.user!.role,
      applicationId: original.applicationId,
      resourceType: "payment_intent",
      // resource_id is a UUID column; Stripe `pi_`/`re_` ids are not — details only.
      details: {
        paymentIntentId,
        refundId,
        amountCents: amountCents ?? original.amountCents,
        reason: reason ?? null,
      },
    });

    void stampTape({
      kind: "BP08_PAYMENT_REFUND_REQUESTED",
      actor: req.user!.id,
      sessionId: refundId,
      payload: {
        applicationId: original.applicationId,
        paymentIntentId,
        refundId,
        amountCents: amountCents ?? original.amountCents,
      },
    });

    // 202: accepted, not yet posted. The webhook posts the ledger entry.
    res.status(202).json({ refundId, status: refundStatus ?? "pending" });
  }
);

export default router;
