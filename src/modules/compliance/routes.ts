import { Router } from "express";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { requirePermission } from "../../middleware/rbac";
import { FairHousingService } from "./fair-housing";
import { logger } from "../../utils/logger";

const router = Router();
const service = new FairHousingService();

/**
 * GET /api/compliance/fair-housing
 * GET /api/compliance/fair-housing?propertyId=<uuid>
 *
 * Generate a Fair Housing Act compliance report.
 * Returns decision outcome statistics, adverse action notice completeness,
 * and documentation of the objective criteria applied to all applicants.
 *
 * Optional query param:
 *   - propertyId: scope the report to a single property
 *
 * Permission: audit:view (Regional Manager+) — same gate as the audit log,
 * since this report is used by compliance officers and regulators.
 */
router.get(
  "/fair-housing",
  authenticate,
  requirePermission("audit:view"),
  async (req: AuthRequest, res) => {
    try {
      const propertyId = req.query.propertyId
        ? (req.query.propertyId as string)
        : null;

      const report = await service.generateReport(propertyId);
      res.json(report);
    } catch (err) {
      logger.error("Failed to generate Fair Housing compliance report", {
        error: (err as Error).message,
      });
      res.status(500).json({ error: "Failed to generate compliance report" });
    }
  }
);

export default router;
