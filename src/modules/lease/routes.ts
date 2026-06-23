import { Router, Response } from "express";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { requirePermission } from "../../middleware/rbac";
import { LeaseService } from "./service";
import { logger } from "../../utils/logger";
import { param } from "../../utils/params";
import { z } from "zod";

const router = Router();
const service = new LeaseService();

// ── Bulk lease generation (throughput) ──────────────────────────────────────
// Operator-triggered: generate leases for many approved + income-verified apps in
// one call (lease-up sprint). Flag-gated (FRANK_BULK_LEASE_GEN_ENABLED). Composes
// the verified single-app generateLease, so the approved-status gate AND the LIHTC
// §42 income-verification gate stay intact; idempotent (already-generated apps are
// skipped as per-app errors); per-app failures never abort the batch. GET /ready is
// declared before GET /:applicationId so it isn't captured as an :applicationId.
const bulkLeaseSchema = z.object({
  applicationIds: z
    .array(z.string().uuid())
    .min(1, "At least one applicationId is required")
    .max(100, "Max 100 applications per batch"),
});

// List applications ready for lease generation (approved + income-verified)
router.get(
  "/ready",
  authenticate,
  requirePermission("lease:generate"),
  async (_req: AuthRequest, res: Response): Promise<void> => {
    try {
      const ready = await service.listReadyForLease();
      res.json({ count: ready.length, applications: ready });
    } catch (err: any) {
      logger.error("Failed to list ready-for-lease applications", { error: err.message });
      res.status(500).json({ error: "Failed to list ready-for-lease applications" });
    }
  }
);

// Bulk-generate leases for the provided approved + income-verified applications
router.post(
  "/bulk",
  authenticate,
  requirePermission("lease:generate"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    if (process.env.FRANK_BULK_LEASE_GEN_ENABLED !== "true") {
      res
        .status(403)
        .json({ error: "Bulk lease generation is disabled (set FRANK_BULK_LEASE_GEN_ENABLED=true)" });
      return;
    }
    try {
      const input = bulkLeaseSchema.parse(req.body);
      const result = await service.bulkGenerate(input.applicationIds, req.user!.id, req.user!.role);
      res.json(result);
    } catch (err: any) {
      if (err.name === "ZodError") {
        res.status(400).json({ error: "Validation failed", details: err.issues });
        return;
      }
      logger.error("Bulk lease generation failed", { error: err.message });
      res.status(400).json({ error: err.message });
    }
  }
);

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
