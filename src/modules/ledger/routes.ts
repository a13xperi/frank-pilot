import { Router, Response } from "express";
import { z } from "zod";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { requirePermission } from "../../middleware/rbac";
import { LedgerService } from "./service";
import { logger } from "../../utils/logger";

const router = Router();
const service = new LedgerService();

// Get ledger entries for a tenant
router.get(
  "/:applicationId",
  authenticate,
  requirePermission("ledger:view"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const result = await service.getLedger(req.params.applicationId as string, {
        billingPeriod: req.query.billingPeriod as string | undefined,
        entryType: req.query.entryType as string | undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
        offset: req.query.offset ? parseInt(req.query.offset as string) : undefined,
      });
      res.json(result);
    } catch (err: any) {
      logger.error("Failed to get ledger", { error: err.message });
      res.status(500).json({ error: "Failed to get ledger" });
    }
  }
);

// Get balance for a tenant
router.get(
  "/:applicationId/balance",
  authenticate,
  requirePermission("ledger:view"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const result = await service.getBalance(req.params.applicationId as string);
      res.json(result);
    } catch (err: any) {
      logger.error("Failed to get balance", { error: err.message });
      res.status(500).json({ error: "Failed to get balance" });
    }
  }
);

// Record a payment
const PaymentSchema = z.object({
  amount: z.number().positive(),
  referenceId: z.string().optional(),
  notes: z.string().optional(),
});

router.post(
  "/:applicationId/payment",
  authenticate,
  requirePermission("ledger:manage"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = PaymentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }
    try {
      const entry = await service.recordPayment(
        req.params.applicationId as string,
        parsed.data.amount,
        parsed.data.referenceId || null,
        req.user!.id,
        req.user!.role,
        parsed.data.notes
      );
      res.status(201).json(entry);
    } catch (err: any) {
      logger.error("Failed to record payment", { error: err.message });
      res.status(400).json({ error: err.message });
    }
  }
);

// Apply a credit
const CreditSchema = z.object({
  amount: z.number().positive(),
  description: z.string().min(1),
});

router.post(
  "/:applicationId/credit",
  authenticate,
  requirePermission("ledger:manage"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = CreditSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }
    try {
      const entry = await service.applyCredit(
        req.params.applicationId as string,
        parsed.data.amount,
        parsed.data.description,
        req.user!.id,
        req.user!.role
      );
      res.status(201).json(entry);
    } catch (err: any) {
      logger.error("Failed to apply credit", { error: err.message });
      res.status(400).json({ error: err.message });
    }
  }
);

// Manual charge
const ChargeSchema = z.object({
  entryType: z.enum(["late_fee", "nsf_fee", "extended_guest_fee", "early_termination_fee", "adjustment"]),
  amount: z.number().positive(),
  description: z.string().min(1),
});

router.post(
  "/:applicationId/charge",
  authenticate,
  requirePermission("ledger:manage"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = ChargeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }
    try {
      const entry = await service.postCharge(
        req.params.applicationId as string,
        parsed.data.entryType,
        parsed.data.amount,
        parsed.data.description,
        req.user!.id,
        req.user!.role
      );
      res.status(201).json(entry);
    } catch (err: any) {
      logger.error("Failed to post charge", { error: err.message });
      res.status(400).json({ error: err.message });
    }
  }
);

// Reverse an entry
const ReverseSchema = z.object({
  reason: z.string().min(1, "Reason is required"),
});

router.post(
  "/entry/:entryId/reverse",
  authenticate,
  requirePermission("ledger:manage"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = ReverseSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }
    try {
      const entry = await service.reverseEntry(
        req.params.entryId as string,
        parsed.data.reason,
        req.user!.id,
        req.user!.role
      );
      res.json(entry);
    } catch (err: any) {
      logger.error("Failed to reverse entry", { error: err.message });
      res.status(400).json({ error: err.message });
    }
  }
);

// Delinquency report
router.get(
  "/delinquencies",
  authenticate,
  requirePermission("ledger:view"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const result = await service.getDelinquencyReport(req.query.propertyId as string | undefined);
      res.json(result);
    } catch (err: any) {
      logger.error("Failed to get delinquency report", { error: err.message });
      res.status(500).json({ error: "Failed to get delinquency report" });
    }
  }
);

// Manual trigger: post monthly rent (system_admin)
router.post(
  "/post-rent",
  authenticate,
  requirePermission("user:manage"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const result = await service.processMonthlyRentPostings();
      res.json(result);
    } catch (err: any) {
      logger.error("Failed to post rent", { error: err.message });
      res.status(500).json({ error: err.message });
    }
  }
);

// Manual trigger: process late fees (system_admin)
router.post(
  "/process-late-fees",
  authenticate,
  requirePermission("user:manage"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const result = await service.processLateFees();
      res.json(result);
    } catch (err: any) {
      logger.error("Failed to process late fees", { error: err.message });
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
