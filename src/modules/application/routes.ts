import { Router, Response } from "express";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { requirePermission } from "../../middleware/rbac";
import { ApplicationService } from "./service";
import { createApplicationSchema, submitApplicationSchema, updateApplicationSchema } from "./validation";
import { logger } from "../../utils/logger";
import { param } from "../../utils/params";

const router = Router();
const service = new ApplicationService();

// Create application (Leasing Agent+)
router.post(
  "/",
  authenticate,
  requirePermission("application:create"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const input = createApplicationSchema.parse(req.body);
      const result = await service.create(input, req.user!.id, req.user!.role);
      res.status(201).json(result);
    } catch (err: any) {
      if (err.name === "ZodError") {
        res.status(400).json({ error: "Validation failed", details: err.issues });
        return;
      }
      logger.error("Failed to create application", { error: err.message });
      res.status(500).json({ error: "Failed to create application" });
    }
  }
);

// List applications
router.get(
  "/",
  authenticate,
  requirePermission("application:read"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const result = await service.list({
        propertyId: req.query.propertyId as string,
        status: req.query.status as string,
        limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
        offset: req.query.offset ? parseInt(req.query.offset as string) : undefined,
      });
      res.json(result);
    } catch (err: any) {
      logger.error("Failed to list applications", { error: err.message });
      res.status(500).json({ error: "Failed to list applications" });
    }
  }
);

// Get application by ID
router.get(
  "/:id",
  authenticate,
  requirePermission("application:read"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const result = await service.getById(param(req.params.id));
      if (!result) {
        res.status(404).json({ error: "Application not found" });
        return;
      }
      res.json(result);
    } catch (err: any) {
      logger.error("Failed to get application", { error: err.message });
      res.status(500).json({ error: "Failed to get application" });
    }
  }
);

// Update draft application
router.patch(
  "/:id",
  authenticate,
  requirePermission("application:create"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const input = updateApplicationSchema.parse(req.body);
      const result = await service.update(param(req.params.id), input);
      res.json(result);
    } catch (err: any) {
      if (err.name === "ZodError") {
        res.status(400).json({ error: "Validation failed", details: err.issues });
        return;
      }
      logger.error("Failed to update application", { error: err.message });
      res.status(400).json({ error: err.message });
    }
  }
);

// Verify income (LIHTC §42 — third-party income verification required before lease generation)
// verifiedIncome (optional): if provided, updates annual_income to the verified value
router.patch(
  "/:id/verify-income",
  authenticate,
  requirePermission("screening:initiate"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const verifiedIncome =
        req.body?.verifiedIncome !== undefined
          ? Number(req.body.verifiedIncome)
          : undefined;

      const result = await service.verifyIncome(
        param(req.params.id),
        req.user!.id,
        req.user!.role,
        verifiedIncome
      );
      res.json(result);
    } catch (err: any) {
      logger.error("Failed to verify income", { error: err.message });
      res.status(400).json({ error: err.message });
    }
  }
);

// Cancel application (Senior Manager+ — screening:initiate permission level)
// Cancellable from: draft, submitted, screening, screening_passed/failed, tier*_review
// Not cancellable from: tier*_approved, tier*_denied, lease_generated, onboarded, cancelled
router.patch(
  "/:id/cancel",
  authenticate,
  requirePermission("screening:initiate"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const result = await service.cancel(
        param(req.params.id),
        req.user!.id,
        req.user!.role,
        req.body?.reason
      );
      res.json(result);
    } catch (err: any) {
      logger.error("Failed to cancel application", { error: err.message });
      res.status(400).json({ error: err.message });
    }
  }
);

// Submit application for screening
router.post(
  "/:id/submit",
  authenticate,
  requirePermission("application:submit"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const result = await service.submit(param(req.params.id), req.user!.id, req.user!.role);
      res.json(result);
    } catch (err: any) {
      logger.error("Failed to submit application", { error: err.message });
      res.status(400).json({ error: err.message });
    }
  }
);

export default router;
