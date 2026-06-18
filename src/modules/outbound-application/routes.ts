import { Router, Response, NextFunction } from "express";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { requirePermission } from "../../middleware/rbac";
import { logger } from "../../utils/logger";
import {
  enqueueApplicationCall,
  cancelApplicationCall,
  listQueue,
} from "./service";

/**
 * Outbound full-application agent admin surface (Frank core C3, "Jacqueline").
 *
 * Mount path: /api/admin/outbound-application
 *   POST   /enqueue/:applicationId   queue a draft for a completion call
 *   GET    /queue                    view the queue
 *   DELETE /enqueue/:applicationId   cancel an open call
 *
 * Fail-closed behind FRANK_OUTBOUND_APPLICATION_ENABLED (same pattern as the
 * outbound-validation surface). The DIAL is DEFERRED — enqueuing only writes
 * the queue row; no call is placed by this code.
 */

const router = Router();

function requireEnabled(_req: AuthRequest, res: Response, next: NextFunction): void {
  if (process.env.FRANK_OUTBOUND_APPLICATION_ENABLED !== "true") {
    res.status(503).json({ error: "Outbound application agent disabled" });
    return;
  }
  next();
}

router.post(
  "/enqueue/:applicationId",
  authenticate,
  requirePermission("outbound_application:run"),
  requireEnabled,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const result = await enqueueApplicationCall({
        applicationId: String(req.params.applicationId),
        testCall: req.body?.testCall === true,
      });
      res.status(result.created ? 201 : 200).json(result);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "APPLICATION_NOT_FOUND") {
        res.status(404).json({ error: "Application not found" });
        return;
      }
      if (code === "APPLICATION_NOT_DRAFT") {
        res.status(409).json({ error: (err as Error).message });
        return;
      }
      logger.error("Enqueue application call failed", { error: (err as Error).message });
      res.status(500).json({ error: "Enqueue failed" });
    }
  }
);

router.get(
  "/queue",
  authenticate,
  requirePermission("outbound_application:view"),
  requireEnabled,
  async (_req: AuthRequest, res: Response): Promise<void> => {
    try {
      res.json({ queue: await listQueue() });
    } catch (err) {
      logger.error("List outbound application queue failed", { error: (err as Error).message });
      res.status(500).json({ error: "Queue failed" });
    }
  }
);

router.delete(
  "/enqueue/:applicationId",
  authenticate,
  requirePermission("outbound_application:run"),
  requireEnabled,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const canceled = await cancelApplicationCall(String(req.params.applicationId));
      if (!canceled) {
        res.status(404).json({ error: "No open call for that application" });
        return;
      }
      res.json({ canceled: true });
    } catch (err) {
      logger.error("Cancel application call failed", { error: (err as Error).message });
      res.status(500).json({ error: "Cancel failed" });
    }
  }
);

export default router;
