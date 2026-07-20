import { Router, Response } from "express";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { requirePermission } from "../../middleware/rbac";
import { ScreeningService } from "./service";
import { FraudDetectionService } from "./fraud-detection";
import { logger } from "../../utils/logger";
import { param } from "../../utils/params";
import { query } from "../../config/database";
import crypto from "crypto";

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

// Batch screen — service-secret-gated operator tool for the DL lease-up pilot.
// Runs runFullScreening over `submitted` applications (the fee-decoupled path:
// screening is triggered here, not by a Stripe payment). Fail-closed: 503 unless
// SCREEN_BATCH_ENABLED=true, 401 unless x-frank-screen-secret matches
// SCREEN_BATCH_SECRET. dryRun (default true) lists targets without screening.
// runFullScreening is idempotent on status (only acts on submitted/screening),
// so re-runs are safe. Registered before the "/:applicationId/..." param routes.
router.post("/batch", async (req: AuthRequest, res: Response): Promise<void> => {
  if (process.env.SCREEN_BATCH_ENABLED !== "true") {
    res.status(503).json({ ok: false, message: "Batch screening disabled" });
    return;
  }
  const secret = process.env.SCREEN_BATCH_SECRET ?? "";
  const provided = String(req.headers["x-frank-screen-secret"] ?? "");
  const authed =
    secret.length > 0 &&
    provided.length === secret.length &&
    crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
  if (!authed) {
    res.status(401).json({ ok: false, message: "Unauthorized" });
    return;
  }

  const dryRun = req.body?.dryRun !== false; // default true — must opt in to real screening
  const limit = Math.min(Math.max(parseInt(String(req.body?.limit ?? "50"), 10) || 50, 1), 200);

  // Only `submitted` apps with a real submitter — the actor columns are UUID-typed
  // (mirrors the auto-on-submit path). `screening`-status apps are mid-pipeline.
  const targets = await query(
    `SELECT id, submitted_by, submitter_role
       FROM applications
      WHERE status = 'submitted' AND submitted_by IS NOT NULL
      ORDER BY submitted_at ASC NULLS LAST
      LIMIT $1`,
    [limit]
  );

  if (dryRun) {
    res.json({ ok: true, dryRun: true, eligible: targets.rows.length, ids: targets.rows.map((r: any) => r.id) });
    return;
  }

  const screened: Array<{ id: string; overallResult: string }> = [];
  const errors: Array<{ id: string; error: string }> = [];
  for (const row of targets.rows) {
    try {
      const result: any = await screeningService.runFullScreening(
        row.id,
        row.submitted_by,
        row.submitter_role ?? "applicant"
      );
      screened.push({ id: row.id, overallResult: result?.overallResult });
    } catch (err: any) {
      errors.push({ id: row.id, error: err.message });
    }
  }
  const summary = screened.reduce((acc: Record<string, number>, s) => {
    const k = s.overallResult ?? "unknown";
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
  logger.info("Batch screening run", { requested: targets.rows.length, screened: screened.length, errors: errors.length, summary });
  res.json({ ok: true, dryRun: false, requested: targets.rows.length, screened, errors, summary });
});

// Staff review queue — applications held in `screening_review` (vendor pipeline
// could not produce a verdict). Registered BEFORE the "/:applicationId/..." param
// routes so the literal path is not captured by the param matcher.
router.get(
  "/review-queue",
  authenticate,
  requirePermission("screening:view"),
  async (_req: AuthRequest, res: Response): Promise<void> => {
    try {
      const queue = await screeningService.getReviewQueue();
      res.json({ queue });
    } catch (err: any) {
      logger.error("Failed to get screening review queue", { error: err.message });
      res.status(500).json({ error: "Failed to get screening review queue" });
    }
  }
);

// Initiate screening (Senior Manager+)
router.post(
  "/:applicationId/screen",
  authenticate,
  requirePermission("screening:initiate"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      // screeningTag is an optional MOCK_MODE knob (e.g. "id_verification_fail")
      // — runtime-only, no DB column. Threaded through to identity/background/
      // credit/compliance services to trigger their canned failure responses.
      const screeningTag = typeof req.body?.screeningTag === "string"
        ? req.body.screeningTag
        : undefined;

      const result: any = await screeningService.runFullScreening(
        param(req.params.applicationId),
        req.user!.id,
        req.user!.role,
        screeningTag
      );
      // runFullScreening returns nested checks but with `result` keys; the client
      // contract is `status`. Rename to match getResults shape when present, but
      // pass through any other fields the service includes (e.g. applicationId).
      const shaped: any = { ...result };
      if (result?.identity) {
        shaped.identity = {
          status: result.identity.result,
          confidence: result.identity.confidence,
          livenessScore: result.identity.livenessScore,
          idType: result.identity.idType,
          details: result.identity.details,
        };
      }
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

// Resolve a held (screening_review) application — staff manual override.
router.post(
  "/:applicationId/review-resolve",
  authenticate,
  requirePermission("screening:initiate"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const decision = req.body?.decision;
      if (decision !== "pass" && decision !== "fail") {
        res.status(400).json({ error: "decision must be 'pass' or 'fail'" });
        return;
      }
      const notes = typeof req.body?.notes === "string" ? req.body.notes : "";

      const result = await screeningService.resolveReview(
        param(req.params.applicationId),
        decision,
        notes,
        req.user!.id,
        req.user!.role
      );
      res.json(result);
    } catch (err: any) {
      logger.error("Failed to resolve screening review", {
        error: err.message,
        applicationId: param(req.params.applicationId),
      });
      res.status(400).json({ error: err.message });
    }
  }
);

// Preview the FCRA adverse-action notice a manual denial would send, WITHOUT
// committing or sending it. Guarded by screening:initiate (only staff who can
// deny may preview the denial). Optional reasonDetail query param mirrors the
// detail a resolveReview('fail') would stamp on the notice.
router.get(
  "/:applicationId/adverse-action/draft",
  authenticate,
  requirePermission("screening:initiate"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const reasonDetail =
        typeof req.query.reasonDetail === "string" ? req.query.reasonDetail : undefined;

      const draft = await screeningService.getAdverseActionDraft(
        param(req.params.applicationId),
        reasonDetail
      );
      res.json({ draft });
    } catch (err: any) {
      logger.error("Failed to generate adverse-action draft", {
        error: err.message,
        applicationId: param(req.params.applicationId),
      });
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
