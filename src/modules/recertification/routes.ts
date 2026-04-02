import { Router, Response } from "express";
import { z } from "zod";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { requirePermission } from "../../middleware/rbac";
import { RecertificationService } from "./service";
import { logger } from "../../utils/logger";

const router = Router();
const service = new RecertificationService();

// List recertifications with filters
router.get(
  "/",
  authenticate,
  requirePermission("recertification:view"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const result = await service.list({
        status: req.query.status as string | undefined,
        propertyId: req.query.propertyId as string | undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
        offset: req.query.offset ? parseInt(req.query.offset as string) : undefined,
      });
      res.json(result);
    } catch (err: any) {
      logger.error("Failed to list recertifications", { error: err.message });
      res.status(500).json({ error: "Failed to list recertifications" });
    }
  }
);

// Upcoming recertifications (due within N days)
router.get(
  "/upcoming",
  authenticate,
  requirePermission("recertification:view"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const days = req.query.days ? parseInt(req.query.days as string) : 60;
      const recertifications = await service.getUpcoming(days);
      res.json({ recertifications });
    } catch (err: any) {
      logger.error("Failed to get upcoming recertifications", { error: err.message });
      res.status(500).json({ error: "Failed to get upcoming recertifications" });
    }
  }
);

// Get single recertification
router.get(
  "/:id",
  authenticate,
  requirePermission("recertification:view"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const recert = await service.getById(req.params.id as string);
      if (!recert) {
        res.status(404).json({ error: "Recertification not found" });
        return;
      }
      res.json(recert);
    } catch (err: any) {
      logger.error("Failed to get recertification", { error: err.message });
      res.status(500).json({ error: "Failed to get recertification" });
    }
  }
);

// Create recertification manually
const CreateSchema = z.object({
  applicationId: z.string().uuid(),
});

router.post(
  "/",
  authenticate,
  requirePermission("recertification:manage"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }
    try {
      const result = await service.createForApplication(parsed.data.applicationId, req.user!.id, req.user!.role);
      res.status(201).json(result);
    } catch (err: any) {
      logger.error("Failed to create recertification", { error: err.message });
      res.status(400).json({ error: err.message });
    }
  }
);

// Submit recertification
const SubmitSchema = z.object({
  newIncome: z.number().positive().optional(),
});

router.post(
  "/:id/submit",
  authenticate,
  requirePermission("recertification:manage"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = SubmitSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }
    try {
      await service.submit(req.params.id as string, req.user!.id, req.user!.role, parsed.data.newIncome);
      res.json({ success: true });
    } catch (err: any) {
      logger.error("Failed to submit recertification", { error: err.message });
      res.status(400).json({ error: err.message });
    }
  }
);

// Review recertification (approve/deny)
const ReviewSchema = z.object({
  decision: z.enum(["pass", "fail"]),
  notes: z.string().min(1, "Review notes are required"),
  newIncome: z.number().positive().optional(),
  rentAdjustment: z.number().optional(),
});

router.post(
  "/:id/review",
  authenticate,
  requirePermission("recertification:review"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = ReviewSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }
    try {
      await service.review(
        req.params.id as string,
        req.user!.id,
        req.user!.role,
        parsed.data.decision,
        parsed.data.notes,
        parsed.data.newIncome,
        parsed.data.rentAdjustment
      );
      res.json({ success: true });
    } catch (err: any) {
      logger.error("Failed to review recertification", { error: err.message });
      res.status(400).json({ error: err.message });
    }
  }
);

// Manual trigger: process all reminders (system_admin)
router.post(
  "/process-reminders",
  authenticate,
  requirePermission("user:manage"), // system_admin only
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const stats = await service.processReminders();
      res.json(stats);
    } catch (err: any) {
      logger.error("Failed to process reminders", { error: err.message });
      res.status(500).json({ error: "Failed to process reminders" });
    }
  }
);

export default router;
