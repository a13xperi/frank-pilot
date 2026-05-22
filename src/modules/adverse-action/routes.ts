import { Router } from "express";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { requirePermission } from "../../middleware/rbac";
import { AdverseActionService } from "./service";
import { logger } from "../../utils/logger";

const router = Router();
const service = new AdverseActionService();

/**
 * GET /api/applications/:applicationId/adverse-action
 *
 * Retrieve the most recently sent adverse action notice for an application.
 * Returns 404 if no notice has been issued yet.
 *
 * Permission: screening:view (senior_manager+) — adverse action is part of the screening outcome
 */
router.get(
  "/:applicationId/adverse-action",
  authenticate,
  requirePermission("screening:view"),
  async (req: AuthRequest, res) => {
    try {
      const notice = await service.getNotice(req.params.applicationId as string);
      if (!notice) {
        res.status(404).json({ error: "No adverse action notice found for this application" });
        return;
      }
      res.json(notice);
    } catch (err) {
      logger.error("Failed to retrieve adverse action notice", {
        error: (err as Error).message,
        applicationId: req.params.applicationId as string,
      });
      res.status(500).json({ error: "Failed to retrieve adverse action notice" });
    }
  }
);

/**
 * POST /api/applications/:applicationId/adverse-action/resend
 *
 * Manually send (or resend) an FCRA adverse action notice. Creates a new
 * notice record — does not overwrite prior notices (immutable audit trail).
 *
 * Body (optional): { reason, reasonDetail }
 * Permission: approval:tier1 (senior_manager+) — only those with approval authority can issue notices
 */
router.post(
  "/:applicationId/adverse-action/resend",
  authenticate,
  requirePermission("approval:tier1"),
  async (req: AuthRequest, res) => {
    try {
      const { reason = "manual_resend", reasonDetail } = req.body ?? {};
      const result = await service.sendNotice(
        req.params.applicationId as string,
        req.user!.id,
        req.user!.role,
        reason,
        reasonDetail
      );
      res.json(result);
    } catch (err) {
      logger.error("Failed to send adverse action notice", {
        error: (err as Error).message,
        applicationId: req.params.applicationId as string,
      });
      res.status(400).json({ error: (err as Error).message });
    }
  }
);

export default router;
