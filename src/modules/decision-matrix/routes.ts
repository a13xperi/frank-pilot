import { Router, Response } from "express";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { requirePermission } from "../../middleware/rbac";
import { DecisionMatrixService } from "./service";
import { logger } from "../../utils/logger";
import { param } from "../../utils/params";
import { z } from "zod";

const router = Router();
const service = new DecisionMatrixService();

const modificationRequestSchema = z.object({
  modificationType: z.enum(["rent_increase", "tenant_substitution", "lease_term_change", "pet_policy_change", "other"]),
  description: z.string().min(1),
  originalValue: z.string().optional(),
  requestedValue: z.string().optional(),
});

const modificationDecisionSchema = z.object({
  decision: z.enum(["approve", "deny"]),
  notes: z.string().min(1, "Decision notes are required"),
});

// Request modification
router.post(
  "/:applicationId",
  authenticate,
  requirePermission("modification:request"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const input = modificationRequestSchema.parse(req.body);
      const result = await service.requestModification({
        applicationId: param(req.params.applicationId),
        ...input,
        requestedBy: req.user!.id,
        requestedByRole: req.user!.role,
      });
      res.status(201).json(result);
    } catch (err: any) {
      if (err.name === "ZodError") {
        res.status(400).json({ error: "Validation failed", details: err.issues });
        return;
      }
      logger.error("Failed to request modification", { error: err.message });
      res.status(400).json({ error: err.message });
    }
  }
);

// Decide modification
router.post(
  "/decide/:modificationId",
  authenticate,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const input = modificationDecisionSchema.parse(req.body);
      const result = await service.decideModification({
        modificationId: param(req.params.modificationId),
        decision: input.decision,
        notes: input.notes,
        decidedBy: req.user!.id,
        decidedByRole: req.user!.role,
      });
      res.json(result);
    } catch (err: any) {
      if (err.name === "ZodError") {
        res.status(400).json({ error: "Validation failed", details: err.issues });
        return;
      }
      logger.error("Failed to decide modification", { error: err.message });
      res.status(400).json({ error: err.message });
    }
  }
);

// List modifications for application
router.get(
  "/:applicationId",
  authenticate,
  requirePermission("lease:modify"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const result = await service.listModifications(param(req.params.applicationId));
      res.json({ modifications: result });
    } catch (err: any) {
      logger.error("Failed to list modifications", { error: err.message });
      res.status(500).json({ error: "Failed to list modifications" });
    }
  }
);

export default router;
