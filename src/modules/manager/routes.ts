import { Router, Response } from "express";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { requirePermission } from "../../middleware/rbac";
import { logger } from "../../utils/logger";
import { managerBriefingService } from "./service";

/**
 * Manager briefing surface.
 *
 * Mount path: /api/manager
 * Permission: manager_briefing:view (senior_manager and up). Property scoping
 * happens inside the service, so a senior manager only ever sees their own
 * portfolio's numbers.
 */

const router = Router();

router.get(
  "/briefing",
  authenticate,
  requirePermission("manager_briefing:view"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const briefing = await managerBriefingService.getBriefing(req, new Date().toISOString());
      res.json(briefing);
    } catch (err) {
      logger.error("manager briefing failed", { error: (err as Error).message });
      res.status(500).json({ error: "Failed to build manager briefing" });
    }
  }
);

export default router;
