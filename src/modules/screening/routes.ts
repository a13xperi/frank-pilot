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

// Shape the DB row into the nested { background, credit, compliance, overallResult }
// contract the client expects. Passes through any pre-shaped fields untouched so
// tests / future callers that already use camelCase keys keep working.
function toClientShape(row: any) {
  if (!row) return row;
  const overallResult = row.overallResult ?? row.overall_screening_result;
  const creditScore = row.creditScore ?? row.credit_score;
  return {
    ...row,
    overallResult,
    creditScore,
    background: row.background ?? {
      status: row.background_check_result,
      details: row.background_check_details,
      completedAt: row.background_check_completed_at,
    },
    credit: row.credit ?? {
      status: row.credit_check_result,
      score: creditScore,
      details: row.credit_check_details,
      completedAt: row.credit_check_completed_at,
    },
    compliance: row.compliance ?? {
      status: row.compliance_check_result,
      details: row.compliance_check_details,
      completedAt: row.compliance_check_completed_at,
    },
  };
}

// Initiate screening (Senior Manager+)
router.post(
  "/:applicationId/screen",
  authenticate,
  requirePermission("screening:initiate"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const result: any = await screeningService.runFullScreening(
        param(req.params.applicationId),
        req.user!.id,
        req.user!.role
      );
      // runFullScreening returns nested checks but with `result` keys; the client
      // contract is `status`. Rename to match getResults shape when present, but
      // pass through any other fields the service includes (e.g. applicationId).
      const shaped: any = { ...result };
      if (result?.background) {
        shaped.background = { status: result.background.result, details: result.background.details };
      }
      if (result?.credit) {
        shaped.credit = {
          status: result.credit.result,
          score: result.credit.creditScore,
          details: result.credit.details,
        };
      }
      if (result?.compliance) {
        shaped.compliance = { status: result.compliance.result, details: result.compliance.details };
      }
      res.json(shaped);
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
      res.json(toClientShape(result));
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
