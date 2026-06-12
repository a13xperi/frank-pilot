import { Router, Response, NextFunction } from "express";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { requirePermission } from "../../middleware/rbac";
import { query } from "../../config/database";
import { logger } from "../../utils/logger";
import { runDialerTick, sweepStuckCalls, isWithinCallWindow } from "./dialer";
import { generateReport } from "./report";
import { isSageConfigured, queueDepth } from "./sage-client";

/**
 * Admin surface for the outbound waitlist-validation dialer.
 *
 * Mount path: /api/admin/outbound-validation
 * Everything 503s while FRANK_OUTBOUND_ENABLED is off (fail-closed, same
 * pattern as the voice-intake surfaces) — DRY_RUN is the safe-trigger mode,
 * not flag-off.
 */

const router = Router();

function requireOutboundEnabled(_req: AuthRequest, res: Response, next: NextFunction): void {
  if (process.env.FRANK_OUTBOUND_ENABLED !== "true") {
    res.status(503).json({ error: "Outbound validation disabled" });
    return;
  }
  next();
}

// Manually fire one dialer tick (same gates as the cron — window, in-flight,
// batch cap, pacing all still apply).
router.post(
  "/dial",
  authenticate,
  requirePermission("outbound_validation:run"),
  requireOutboundEnabled,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const result = await runDialerTick({ trigger: "manual" });
      logger.info("Manual outbound-validation dial tick", {
        userId: req.user?.id,
        result,
      });
      res.json(result);
    } catch (err) {
      logger.error("Manual dial tick failed", { error: (err as Error).message });
      res.status(500).json({ error: "Dial tick failed" });
    }
  }
);

// Manually run the stuck-call sweeper.
router.post(
  "/sweep",
  authenticate,
  requirePermission("outbound_validation:run"),
  requireOutboundEnabled,
  async (_req: AuthRequest, res: Response): Promise<void> => {
    try {
      res.json(await sweepStuckCalls());
    } catch (err) {
      logger.error("Manual sweep failed", { error: (err as Error).message });
      res.status(500).json({ error: "Sweep failed" });
    }
  }
);

router.get(
  "/status",
  authenticate,
  requirePermission("outbound_validation:view"),
  requireOutboundEnabled,
  async (_req: AuthRequest, res: Response): Promise<void> => {
    try {
      const [todayResult, inFlightResult, depth] = await Promise.all([
        query(
          `SELECT COUNT(*)::int AS count FROM outbound_validation_calls
            WHERE status <> 'dry_run'
              AND (dialed_at AT TIME ZONE 'America/Los_Angeles')::date
                  = (NOW() AT TIME ZONE 'America/Los_Angeles')::date`,
          []
        ),
        query(
          `SELECT applicant_id, conversation_id, dialed_at
             FROM outbound_validation_calls
            WHERE status = 'dialed'
            ORDER BY dialed_at DESC
            LIMIT 1`,
          []
        ),
        isSageConfigured() ? queueDepth() : Promise.resolve(-1),
      ]);
      res.json({
        enabled: true,
        dryRun: process.env.FRANK_OUTBOUND_DRY_RUN === "true",
        testNumberSet: Boolean((process.env.FRANK_OUTBOUND_TEST_NUMBER ?? "").trim()),
        batchLimit: Number(process.env.FRANK_OUTBOUND_BATCH_LIMIT ?? 5),
        paceMinutes: Number(process.env.FRANK_OUTBOUND_PACE_MINUTES ?? 5),
        withinCallWindow: isWithinCallWindow(),
        sageConfigured: isSageConfigured(),
        queueDepth: depth,
        dialsToday: Number(todayResult.rows[0]?.count ?? 0),
        inFlight: inFlightResult.rows[0] ?? null,
      });
    } catch (err) {
      logger.error("Outbound-validation status failed", { error: (err as Error).message });
      res.status(500).json({ error: "Status failed" });
    }
  }
);

router.get(
  "/report",
  authenticate,
  requirePermission("outbound_validation:view"),
  requireOutboundEnabled,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { markdown, csv, summary } = await generateReport();
      const format = String(req.query.format ?? "md");
      if (format === "csv") {
        res.type("text/csv").send(csv);
      } else if (format === "json") {
        res.json({ summary });
      } else {
        res.type("text/markdown").send(markdown);
      }
    } catch (err) {
      logger.error("Outbound-validation report failed", { error: (err as Error).message });
      res.status(500).json({ error: "Report failed" });
    }
  }
);

export default router;
