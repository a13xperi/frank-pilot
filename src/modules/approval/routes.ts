import { Router, Response } from "express";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { requirePermission } from "../../middleware/rbac";
import { ApprovalService } from "./service";
import { logger } from "../../utils/logger";
import { param } from "../../utils/params";
import { z } from "zod";

const router = Router();
const service = new ApprovalService();

const approvalSchema = z.object({
  decision: z.enum(["pass", "fail"]),
  notes: z.string().min(1, "Review notes are required"),
});

// Tier 1: Senior Manager review
router.post(
  "/:applicationId/tier1",
  authenticate,
  requirePermission("approval:tier1"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const input = approvalSchema.parse(req.body);
      const result = await service.tier1Review({
        applicationId: param(req.params.applicationId),
        decision: input.decision,
        notes: input.notes,
        reviewerId: req.user!.id,
        reviewerRole: req.user!.role,
      });
      res.json(result);
    } catch (err: any) {
      if (err.name === "ZodError") {
        res.status(400).json({ error: "Validation failed", details: err.issues });
        return;
      }
      logger.error("Tier 1 review failed", { error: err.message });
      res.status(400).json({ error: err.message });
    }
  }
);

// Tier 2: Regional Manager review
router.post(
  "/:applicationId/tier2",
  authenticate,
  requirePermission("approval:tier2"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const input = approvalSchema.parse(req.body);
      const result = await service.tier2Review({
        applicationId: param(req.params.applicationId),
        decision: input.decision,
        notes: input.notes,
        reviewerId: req.user!.id,
        reviewerRole: req.user!.role,
      });
      res.json(result);
    } catch (err: any) {
      if (err.name === "ZodError") {
        res.status(400).json({ error: "Validation failed", details: err.issues });
        return;
      }
      logger.error("Tier 2 review failed", { error: err.message });
      res.status(400).json({ error: err.message });
    }
  }
);

// Tier 3: Asset Manager review
router.post(
  "/:applicationId/tier3",
  authenticate,
  requirePermission("approval:tier3"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const input = approvalSchema.parse(req.body);
      const result = await service.tier3Review({
        applicationId: param(req.params.applicationId),
        decision: input.decision,
        notes: input.notes,
        reviewerId: req.user!.id,
        reviewerRole: req.user!.role,
      });
      res.json(result);
    } catch (err: any) {
      if (err.name === "ZodError") {
        res.status(400).json({ error: "Validation failed", details: err.issues });
        return;
      }
      logger.error("Tier 3 review failed", { error: err.message });
      res.status(400).json({ error: err.message });
    }
  }
);

// Get approval status
router.get(
  "/:applicationId/status",
  authenticate,
  requirePermission("application:read"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const result = await service.getApprovalStatus(param(req.params.applicationId));
      res.json(result);
    } catch (err: any) {
      logger.error("Failed to get approval status", { error: err.message });
      res.status(400).json({ error: err.message });
    }
  }
);

// ── Bulk tier review ────────────────────────────────────────────────────────
// Relieve the manual one-by-one approval bottleneck (e.g. a lease-up sprint on a
// deadline). Flag-gated (FRANK_BULK_APPROVAL_ENABLED). Each application still runs
// the FULL single-app review (separation of duties, status gate, fraud block,
// audit, FCRA) via service.bulkReview — nothing is bypassed; per-app errors are
// returned, not fatal. Paths are /tierN/bulk to avoid colliding with the
// /:applicationId/tierN routes above.
const bulkApprovalSchema = z.object({
  applicationIds: z
    .array(z.string().uuid())
    .min(1, "At least one applicationId is required")
    .max(100, "Max 100 applications per batch"),
  decision: z.enum(["pass", "fail"]),
  notes: z.string().min(1, "Review notes are required"),
});

function bulkHandler(tier: 1 | 2 | 3) {
  return async (req: AuthRequest, res: Response): Promise<void> => {
    if (process.env.FRANK_BULK_APPROVAL_ENABLED !== "true") {
      res
        .status(403)
        .json({ error: "Bulk approval is disabled (set FRANK_BULK_APPROVAL_ENABLED=true)" });
      return;
    }
    try {
      const input = bulkApprovalSchema.parse(req.body);
      const result = await service.bulkReview(tier, {
        applicationIds: input.applicationIds,
        decision: input.decision,
        notes: input.notes,
        reviewerId: req.user!.id,
        reviewerRole: req.user!.role,
      });
      res.json(result);
    } catch (err: any) {
      if (err.name === "ZodError") {
        res.status(400).json({ error: "Validation failed", details: err.issues });
        return;
      }
      logger.error(`Bulk Tier ${tier} review failed`, { error: err.message });
      res.status(400).json({ error: err.message });
    }
  };
}

router.post("/tier1/bulk", authenticate, requirePermission("approval:tier1"), bulkHandler(1));
router.post("/tier2/bulk", authenticate, requirePermission("approval:tier2"), bulkHandler(2));
router.post("/tier3/bulk", authenticate, requirePermission("approval:tier3"), bulkHandler(3));

export default router;
