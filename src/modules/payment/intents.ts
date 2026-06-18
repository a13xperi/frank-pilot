import { Router, Response } from "express";
import type Stripe from "stripe";
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
 *
 * Payment rails:
 *   - `card` (default)             → card-only PaymentIntent, instant confirm.
 *   - `us_bank_account`            → ACH debit. We pin `payment_method_types`
 *     to `["us_bank_account"]` and set `payment_method_options.us_bank_account`
 *     so Stripe runs the bank-account verification flow client-side. ACH
 *     settles asynchronously: the PaymentIntent often lands in `processing`
 *     first and only later fires `payment_intent.succeeded` (or .payment_failed
 *     on an R01-style return). Our webhook already treats those as the terminal
 *     events, so no webhook change is needed.
 *
 * Fee pass-through:
 *   - `surchargeCents`     → a convenience fee ADDED to the amount the customer
 *     is charged. The persisted `amount_cents` (and therefore the refund cap)
 *     reflects the grand total `amountCents + surchargeCents`, so a full refund
 *     returns everything the customer actually paid.
 *   - `applicationFeeCents`→ Stripe Connect `application_fee_amount`: the slice
 *     of the (already-surcharged) total that routes to the platform account.
 *     Never added to `amount`. Stripe REJECTS a bare `application_fee_amount`
 *     unless the charge also carries `transfer_data[destination]` (a destination
 *     charge on a connected account), so this field is only honoured alongside
 *     `destinationAccount`; supplying the fee without a destination is a 400 —
 *     we never hand Stripe a config it will reject. `onBehalfOf` is forwarded
 *     when present for the cross-region settlement-merchant case.
 */

const PAYMENT_METHODS = ["card", "us_bank_account"] as const;
type PaymentMethod = (typeof PAYMENT_METHODS)[number];

const intentSchema = z.object({
  applicationId: z.string().guid(),
  amountCents: z.number().int().positive().max(10_000_000),
  currency: z
    .string()
    .length(3)
    .transform((s) => s.toLowerCase())
    .optional(),
  attemptN: z.number().int().positive(),
  // ACH (`us_bank_account`) or card (default). Card stays the implicit default
  // so existing callers that omit the field are unchanged.
  paymentMethod: z.enum(PAYMENT_METHODS).optional(),
  // Convenience fee added on top of amountCents — bounded to the same ceiling.
  surchargeCents: z.number().int().nonnegative().max(10_000_000).optional(),
  // Stripe Connect platform fee taken from the total. Cannot exceed the total.
  // Requires `destinationAccount` — Stripe rejects a bare application fee.
  applicationFeeCents: z.number().int().nonnegative().max(20_000_000).optional(),
  // Connected account that the funds settle into (the `acct_…` id). Mandatory
  // whenever `applicationFeeCents` is set — it becomes `transfer_data.destination`,
  // turning the charge into a destination charge so the platform fee is legal.
  destinationAccount: z.string().min(1).optional(),
  // Cross-region settlement merchant (`on_behalf_of`). Optional; forwarded as-is
  // when present so funds settle in the connected account's region.
  onBehalfOf: z.string().min(1).optional(),
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
    const paymentMethod: PaymentMethod = input.paymentMethod ?? "card";
    const surchargeCents = input.surchargeCents ?? 0;
    // Grand total the customer is charged: base + convenience surcharge. This is
    // what we persist and what refunds cap against.
    const totalCents = amountCents + surchargeCents;
    const applicationFeeCents = input.applicationFeeCents;
    const { destinationAccount, onBehalfOf } = input;

    // Each field is individually capped at 10_000_000, but the SUM is not — two
    // maxed fields would charge ~$200k. Cap the grand total at the same $100k
    // ceiling so the surcharge can't smuggle the charge past it.
    if (totalCents > 10_000_000) {
      res
        .status(400)
        .json({ error: "amountCents + surchargeCents exceeds the 10,000,000 ceiling" });
      return;
    }

    // A Connect application fee can never exceed the total being charged — Stripe
    // would reject it, but failing fast here keeps a bad caller out of Stripe.
    if (applicationFeeCents != null && applicationFeeCents > totalCents) {
      res
        .status(400)
        .json({ error: "applicationFeeCents cannot exceed the charged total" });
      return;
    }

    // Stripe rejects a PaymentIntent that sets `application_fee_amount` without a
    // `transfer_data[destination]`. Reject the bad shape here rather than letting
    // every fee-bearing caller eat a hard Stripe error — and never silently emit
    // a bare application fee that Stripe would refuse.
    if (applicationFeeCents != null && !destinationAccount) {
      res.status(400).json({
        error: "destinationAccount is required when applicationFeeCents is set",
      });
      return;
    }

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
      const params: Stripe.PaymentIntentCreateParams = {
        amount: totalCents,
        currency,
        // Pin the rail so the client renders the right element and Stripe
        // doesn't silently fall back to card. Card stays single-method too, to
        // keep the metadata→webhook contract one-payment-method-per-intent.
        payment_method_types: [paymentMethod],
        metadata: {
          applicationId,
          attemptN: String(attemptN),
          actorId: req.user.id,
          paymentMethod,
          baseAmountCents: String(amountCents),
          surchargeCents: String(surchargeCents),
        },
      };

      if (paymentMethod === "us_bank_account") {
        // `automatic` lets Stripe pick instant (Financial Connections) when the
        // bank supports it and fall back to microdeposits otherwise — the right
        // default for a tenant-facing ACH flow.
        params.payment_method_options = {
          us_bank_account: { verification_method: "automatic" },
        };
      }

      if (applicationFeeCents != null) {
        // Guarded above: applicationFeeCents implies a destinationAccount, so
        // the application fee always rides on a destination charge — the only
        // shape Stripe accepts a platform fee on.
        params.application_fee_amount = applicationFeeCents;
        params.transfer_data = { destination: destinationAccount! };
        // Cross-region settlement merchant, when the caller supplies one.
        if (onBehalfOf) {
          params.on_behalf_of = onBehalfOf;
        }
        params.metadata!.applicationFeeCents = String(applicationFeeCents);
        params.metadata!.destinationAccount = destinationAccount!;
        if (onBehalfOf) {
          params.metadata!.onBehalfOf = onBehalfOf;
        }
      }

      const intent = await stripe.paymentIntents.create(params, { idempotencyKey });

      if (!intent.client_secret) {
        throw new Error("Stripe returned PaymentIntent without client_secret");
      }

      await insertPending({
        idempotencyKey,
        applicationId,
        attemptN,
        // Persist the grand total so the refund route caps against everything
        // the customer paid (base + surcharge), not just the base.
        amountCents: totalCents,
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
          amountCents: totalCents,
          baseAmountCents: amountCents,
          surchargeCents,
          applicationFeeCents: applicationFeeCents ?? null,
          paymentMethod,
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
        // NB: resource_id is a UUID column; a Stripe `pi_…` id is not a UUID,
        // so the intent id lives in details, not resourceId.
        details: {
          attemptN,
          amountCents: totalCents,
          baseAmountCents: amountCents,
          surchargeCents,
          applicationFeeCents: applicationFeeCents ?? null,
          paymentMethod,
          currency,
          idempotencyKey,
          paymentIntentId: intent.id,
        },
      });

      res.status(201).json({
        clientSecret: intent.client_secret,
        paymentIntentId: intent.id,
        idempotencyKey,
        paymentMethod,
        amountCents: totalCents,
      });
    } catch (err) {
      logger.error("PaymentIntent create failed", {
        error: (err as Error).message,
        applicationId,
        attemptN,
        paymentMethod,
      });
      res.status(502).json({ error: "Failed to create payment intent" });
    }
  }
);

export default router;
