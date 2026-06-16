import { Router, Request, Response, NextFunction } from "express";
import { logger } from "../../utils/logger";
import { cockpitMetricsService } from "./service";

/**
 * Cockpit metrics surface — NO-PII aggregate counts for the token-watch Frank tab.
 *
 * Mount path: /api/cockpit
 * Auth: a shared secret, not a user session (the cockpit is a dashboard, not a
 * logged-in user). Fail-closed: returns 503 until COCKPIT_METRICS_TOKEN is set,
 * then requires it via `Authorization: Bearer <token>` or `x-cockpit-token`.
 * The payload is counts only, so the secret guards surface area, not PII.
 */

function requireCockpitToken(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.COCKPIT_METRICS_TOKEN;
  if (!expected) {
    res.status(503).json({ error: "cockpit metrics disabled" });
    return;
  }
  const header = req.headers.authorization || "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  const provided = bearer || (req.headers["x-cockpit-token"] as string) || "";
  if (provided !== expected) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

const router = Router();

router.get(
  "/inbound-metrics",
  requireCockpitToken,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const metrics = await cockpitMetricsService.getInboundMetrics();
      res.json(metrics);
    } catch (err) {
      logger.error("cockpit inbound metrics failed", { error: (err as Error).message });
      res.status(500).json({ error: "Failed to load inbound metrics" });
    }
  }
);

export default router;
