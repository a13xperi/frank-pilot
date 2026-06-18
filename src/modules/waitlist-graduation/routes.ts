import { Router, Response } from "express";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { requirePermission } from "../../middleware/rbac";
import { logger } from "../../utils/logger";
import { graduateWaitlistEntry } from "./service";

/**
 * Waitlist→application graduation surface (Frank core C5).
 *
 * Mount path: /api/waitlist
 *   POST /:waitlistEntryId/graduate   promote a waitlist entry to an app draft
 *
 * Producing an application draft is `application:create` authority (leasing
 * agent+). Idempotent: a re-POST returns the existing application with
 * created:false and a 200 (not 201).
 */

const router = Router();

router.post(
  "/:waitlistEntryId/graduate",
  authenticate,
  requirePermission("application:create"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const waitlistEntryId = String(req.params.waitlistEntryId ?? "").trim();
    if (!waitlistEntryId) {
      res.status(400).json({ error: "waitlistEntryId required" });
      return;
    }
    try {
      const result = await graduateWaitlistEntry({
        waitlistEntryId,
        actorId: req.user?.id ?? null,
        requestedMoveInDate:
          typeof req.body?.requestedMoveInDate === "string"
            ? req.body.requestedMoveInDate
            : null,
      });
      res.status(result.created ? 201 : 200).json(result);
    } catch (err) {
      if ((err as { code?: string }).code === "WAITLIST_ENTRY_NOT_FOUND") {
        res.status(404).json({ error: "Waitlist entry not found" });
        return;
      }
      logger.error("Waitlist graduation failed", { error: (err as Error).message });
      res.status(500).json({ error: "Graduation failed" });
    }
  }
);

export default router;
