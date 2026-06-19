import { Router, Response } from "express";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { requirePermission } from "../../middleware/rbac";
import { logger } from "../../utils/logger";
import {
  captureCallFeedback,
  getFeedbackForCall,
  type CallFeedbackMark,
} from "./service";
import { assembleTrainingDataset } from "./dataset";

/**
 * Tenant-call feedback surface (Frank core C1).
 *
 * Mount path: /api/call-feedback
 *   POST /:conversationId      capture a good/bad mark on a call transcript
 *   GET  /:conversationId      list marks for one call
 *   GET  /dataset              assemble + return the training corpus (JSONL/JSON)
 *
 * Capture is open to leasing agents (they triage and rate calls); the dataset
 * export is senior+ (it surfaces structured transcript content in bulk). All
 * routes require auth.
 */

const router = Router();

const VALID_MARKS = new Set<CallFeedbackMark>(["good", "bad"]);

router.post(
  "/:conversationId",
  authenticate,
  requirePermission("call_feedback:capture"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const conversationId = String(req.params.conversationId ?? "").trim();
    const mark = String(req.body?.mark ?? "").trim() as CallFeedbackMark;
    if (!conversationId) {
      res.status(400).json({ error: "conversationId required" });
      return;
    }
    if (!VALID_MARKS.has(mark)) {
      res.status(400).json({ error: "mark must be 'good' or 'bad'" });
      return;
    }
    const tagsRaw = req.body?.tags;
    const tags = Array.isArray(tagsRaw) ? tagsRaw.map(String) : undefined;

    try {
      const row = await captureCallFeedback({
        conversationId,
        mark,
        ratedBy: req.user?.id ?? null,
        note: typeof req.body?.note === "string" ? req.body.note : null,
        tags,
      });
      res.status(201).json(row);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "CALL_NOT_FOUND") {
        res.status(404).json({ error: "Call not found" });
        return;
      }
      if (code === "CALL_NOT_MARKABLE") {
        res.status(409).json({ error: (err as Error).message });
        return;
      }
      logger.error("Capture call feedback failed", { error: (err as Error).message });
      res.status(500).json({ error: "Capture failed" });
    }
  }
);

router.get(
  "/dataset",
  authenticate,
  requirePermission("call_feedback:dataset"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const result = await assembleTrainingDataset({
        includeNegatives: req.query.includeNegatives === "true",
        incrementalOnly: req.query.incrementalOnly === "true",
        // Read-only export by default — only stamp dataset_included_at when the
        // caller explicitly commits this as a real refresh.
        markIncluded: req.query.markIncluded === "true",
      });
      const format = String(req.query.format ?? "json");
      if (format === "jsonl") {
        res.type("application/x-ndjson").send(result.jsonl);
      } else {
        res.json({ counts: result.counts, examples: result.examples });
      }
    } catch (err) {
      logger.error("Assemble dataset failed", { error: (err as Error).message });
      res.status(500).json({ error: "Dataset assembly failed" });
    }
  }
);

router.get(
  "/:conversationId",
  authenticate,
  requirePermission("call_feedback:view"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const conversationId = String(req.params.conversationId ?? "").trim();
    if (!conversationId) {
      res.status(400).json({ error: "conversationId required" });
      return;
    }
    try {
      const rows = await getFeedbackForCall(conversationId);
      res.json({ conversationId, feedback: rows });
    } catch (err) {
      logger.error("Get call feedback failed", { error: (err as Error).message });
      res.status(500).json({ error: "Lookup failed" });
    }
  }
);

export default router;
