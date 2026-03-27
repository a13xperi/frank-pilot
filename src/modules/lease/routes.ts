import { Router, Response } from "express";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { requirePermission } from "../../middleware/rbac";
import { LeaseService } from "./service";
import { logger } from "../../utils/logger";
import { param } from "../../utils/params";

const router = Router();
const service = new LeaseService();

// Generate lease document (Senior Manager+)
router.post(
  "/:applicationId/generate",
  authenticate,
  requirePermission("lease:generate"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const result = await service.generateLease(
        param(req.params.applicationId),
        req.user!.id,
        req.user!.role
      );
      res.json(result);
    } catch (err: any) {
      logger.error("Lease generation failed", {
        error: err.message,
        applicationId: param(req.params.applicationId),
      });
      res.status(400).json({ error: err.message });
    }
  }
);

// Complete tenant onboarding (Senior Manager+)
router.post(
  "/:applicationId/onboard",
  authenticate,
  requirePermission("lease:generate"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const result = await service.completeOnboarding(
        param(req.params.applicationId),
        req.user!.id,
        req.user!.role
      );
      res.json(result);
    } catch (err: any) {
      logger.error("Onboarding failed", {
        error: err.message,
        applicationId: param(req.params.applicationId),
      });
      res.status(400).json({ error: err.message });
    }
  }
);

// Get lease status (all authenticated users)
router.get(
  "/:applicationId",
  authenticate,
  requirePermission("application:read"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const result = await service.getLeaseStatus(param(req.params.applicationId));
      if (!result) {
        res.status(404).json({ error: "Application not found" });
        return;
      }
      res.json(result);
    } catch (err: any) {
      logger.error("Failed to get lease status", { error: err.message });
      res.status(500).json({ error: "Failed to get lease status" });
    }
  }
);

export default router;
