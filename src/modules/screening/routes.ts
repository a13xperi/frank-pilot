import { Router, Response } from "express";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { requirePermission } from "../../middleware/rbac";
import { ScreeningService } from "./service";
import { FraudDetectionService } from "./fraud-detection";
import { logger } from "../../utils/logger";
import { param } from "../../utils/params";

const router = Router();
const screeningService = new ScreeningService();
const fraudService = new FraudDetectionService();

// Initiate screening (Senior Manager+)
router.post(
  "/:applicationId/screen",
  authenticate,
  requirePermission("screening:initiate"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const result = await screeningService.runFullScreening(
        param(req.params.applicationId),
        req.user!.id,
        req.user!.role
      );
      res.json(result);
    } catch (err: any) {
      logger.error("Screening failed", { error: err.message, applicationId: param(req.params.applicationId) });
      res.status(400).json({ error: err.message });
    }
  }
);

// Get screening results (Senior Manager+)
router.get(
  "/:applicationId/results",
  authenticate,
  requirePermission("screening:view"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const result = await screeningService.getResults(param(req.params.applicationId));
      if (!result) {
        res.status(404).json({ error: "Screening results not found" });
        return;
      }
      res.json(result);
    } catch (err: any) {
      logger.error("Failed to get screening results", { error: err.message });
      res.status(500).json({ error: "Failed to get screening results" });
    }
  }
);

// Get fraud flags (Senior Manager+)
router.get(
  "/:applicationId/fraud-flags",
  authenticate,
  requirePermission("fraud:view"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const flags = await fraudService.getUnresolvedFlags(param(req.params.applicationId));
      res.json({ flags });
    } catch (err: any) {
      logger.error("Failed to get fraud flags", { error: err.message });
      res.status(500).json({ error: "Failed to get fraud flags" });
    }
  }
);

// Resolve fraud flag (Regional Manager+)
router.post(
  "/fraud-flags/:flagId/resolve",
  authenticate,
  requirePermission("fraud:resolve"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { notes } = req.body;
      if (!notes) {
        res.status(400).json({ error: "Resolution notes are required" });
        return;
      }
      const result = await fraudService.resolveFlag(param(req.params.flagId), req.user!.id, notes);
      res.json(result);
    } catch (err: any) {
      logger.error("Failed to resolve fraud flag", { error: err.message });
      res.status(500).json({ error: "Failed to resolve fraud flag" });
    }
  }
);

export default router;
