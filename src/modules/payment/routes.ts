import { Router, Response } from "express";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { requirePermission } from "../../middleware/rbac";
import { PaymentService } from "./service";
import { logger } from "../../utils/logger";
import { param } from "../../utils/params";
import { z } from "zod";
import intentsRouter from "./intents";
import configRouter from "./config";
import refundsRouter from "./refunds";

const router = Router();
const service = new PaymentService();

// BP-08 sub-routes. Mounted at the top of the router so they take precedence
// over any `:applicationId`-bound paths below.
router.use("/intents", intentsRouter);
router.use("/config", configRouter);
router.use("/refunds", refundsRouter);

const setupPaymentSchema = z.object({
  paymentMethodId: z.string().min(1),
  paymentType: z.enum(["ach", "credit_card", "debit_card", "bank_transfer"]),
});

// Create Stripe customer
router.post(
  "/:applicationId/customer",
  authenticate,
  requirePermission("payment:setup"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { email, firstName, lastName } = req.body;
      const result = await service.createCustomer({
        applicationId: param(req.params.applicationId),
        email,
        firstName,
        lastName,
        actorId: req.user!.id,
        actorRole: req.user!.role,
      });
      res.json(result);
    } catch (err: unknown) {
      if (err instanceof Error) {
        logger.error("Failed to create customer", { error: err.message });
        res.status(400).json({ error: err.message });
        return;
      }

      logger.error("Failed to create customer", { error: "Unknown error" });
      res.status(400).json({ error: "Failed to create customer" });
    }
  }
);

// Set up payment method
router.post(
  "/:applicationId/method",
  authenticate,
  requirePermission("payment:setup"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const input = setupPaymentSchema.parse(req.body);
      const result = await service.setupPaymentMethod({
        applicationId: param(req.params.applicationId),
        paymentMethodId: input.paymentMethodId,
        paymentType: input.paymentType,
        actorId: req.user!.id,
        actorRole: req.user!.role,
      });
      res.json(result);
    } catch (err: unknown) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: "Validation failed", details: err.issues });
        return;
      }

      if (err instanceof Error) {
        logger.error("Failed to setup payment", { error: err.message });
        res.status(400).json({ error: err.message });
        return;
      }

      logger.error("Failed to setup payment", { error: "Unknown error" });
      res.status(400).json({ error: "Failed to setup payment" });
    }
  }
);

// Enroll in auto-pay
router.post(
  "/:applicationId/auto-pay",
  authenticate,
  requirePermission("payment:setup"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const result = await service.enrollAutoPay({
        applicationId: param(req.params.applicationId),
        actorId: req.user!.id,
        actorRole: req.user!.role,
      });
      res.json(result);
    } catch (err: unknown) {
      if (err instanceof Error) {
        logger.error("Failed to enroll auto-pay", { error: err.message });
        res.status(400).json({ error: err.message });
        return;
      }

      logger.error("Failed to enroll auto-pay", { error: "Unknown error" });
      res.status(400).json({ error: "Failed to enroll auto-pay" });
    }
  }
);

// Get payment status
router.get(
  "/:applicationId",
  authenticate,
  requirePermission("payment:view"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const result = await service.getPaymentStatus(param(req.params.applicationId));
      if (!result) {
        res.status(404).json({ error: "Application not found" });
        return;
      }
      res.json(result);
    } catch (err: unknown) {
      if (err instanceof Error) {
        logger.error("Failed to get payment status", { error: err.message });
      } else {
        logger.error("Failed to get payment status", { error: "Unknown error" });
      }

      res.status(500).json({ error: "Failed to get payment status" });
    }
  }
);

export default router;
