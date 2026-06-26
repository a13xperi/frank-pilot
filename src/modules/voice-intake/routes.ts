import { Router, Response } from "express";
import { z } from "zod";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { sanitizeObject } from "../../utils/pii-filter";
import { requirePermission } from "../../middleware/rbac";
import { query } from "../../config/database";
import { logger } from "../../utils/logger";
import { param } from "../../utils/params";
import { promoteIntakeToApplication, rejectIntake } from "./service";

/**
 * PM-console routes for voice intakes.
 *
 * Mount path: /api/pm/voice-intakes
 * All routes require authentication; list/detail are open to leasing agents
 * (so they can triage the callback queue), approve/reject is senior+ only.
 *
 * No raw-body concerns here — these endpoints are mounted AFTER the global
 * express.json(); the webhook is a separate router with its own raw mount.
 */

const router = Router();

const listQuerySchema = z.object({
  status: z.enum(["all", "pending", "approved", "rejected", "callback"]).default("pending"),
  language: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

router.get(
  "/",
  authenticate,
  requirePermission("voice_intake:view"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid query", details: parsed.error.format() });
      return;
    }
    const { status, language, limit, offset } = parsed.data;

    const where: string[] = [];
    const params: unknown[] = [];
    if (status === "pending") {
      where.push(`applicant_id IS NULL AND callback_requested = FALSE`);
    } else if (status === "approved") {
      where.push(`applicant_id IS NOT NULL`);
    } else if (status === "rejected") {
      // No explicit rejected_at yet — surface rows the PM has decisioned away
      // (no applicant, no pending callback) via call_successful='failure'.
      where.push(`applicant_id IS NULL AND callback_requested = FALSE AND call_successful = 'failure'`);
    } else if (status === "callback") {
      where.push(`callback_requested = TRUE`);
    }
    if (language) {
      params.push(language);
      where.push(`language = $${params.length}`);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    params.push(limit, offset);
    const limitIdx = params.length - 1;
    const offsetIdx = params.length;

    try {
      const rows = await query(
        `SELECT id, conversation_id, agent_id, started_at, ended_at, language,
                call_successful, consent_recording, callback_requested,
                applicant_id,
                data_collection_results->'name'->>'value' AS name,
                data_collection_results->'phone'->>'value' AS phone,
                data_collection_results->'current_city'->>'value' AS current_city
           FROM voice_intake_calls
           ${whereSql}
           ORDER BY started_at DESC
           LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        params
      );
      const totalRes = await query(
        `SELECT COUNT(*)::int AS total FROM voice_intake_calls ${whereSql}`,
        params.slice(0, params.length - 2)
      );
      res.json({ calls: rows.rows, total: Number(totalRes.rows[0]?.total ?? 0) });
    } catch (err) {
      logger.error("voice-intake list failed", { error: (err as Error).message });
      res.status(500).json({ error: "Failed to list voice intakes" });
    }
  }
);

router.get(
  "/:id",
  authenticate,
  requirePermission("voice_intake:view"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const id = param(req.params.id);
      const result = await query(
        `SELECT id, conversation_id, agent_id, started_at, ended_at, language,
                call_successful, evaluation_criteria_results, data_collection_results,
                transcript_url, audio_url, cost_breakdown,
                consent_recording, callback_requested,
                applicant_id, raw_payload, created_at, updated_at
           FROM voice_intake_calls WHERE id = $1`,
        [id]
      );
      const row = result.rows[0];
      if (!row) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      // Defense-in-depth (audit C1): redact PII from raw_payload on read too, so
      // rows persisted BEFORE the write-side redaction (or any residual pattern)
      // never leave the API as plaintext SSN/DOB.
      if (row.raw_payload && typeof row.raw_payload === "object") {
        row.raw_payload = sanitizeObject(row.raw_payload as Record<string, unknown>);
      }
      res.json(row);
    } catch (err) {
      logger.error("voice-intake detail failed", { error: (err as Error).message });
      res.status(500).json({ error: "Failed to load voice intake" });
    }
  }
);

const approveSchema = z.object({
  propertyId: z.string().uuid(),
});

router.post(
  "/:id/approve",
  authenticate,
  requirePermission("voice_intake:approve"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = approveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", details: parsed.error.format() });
      return;
    }
    try {
      const { applicationId } = await promoteIntakeToApplication({
        callId: param(req.params.id),
        propertyId: parsed.data.propertyId,
        actorId: req.user!.id,
      });
      res.json({ applicationId });
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e.code === "ALREADY_PROMOTED") {
        res.status(409).json({ error: "Voice intake already promoted to application" });
        return;
      }
      logger.error("voice-intake approve failed", { error: e.message });
      res.status(500).json({ error: "Failed to approve voice intake" });
    }
  }
);

const rejectSchema = z.object({
  reason: z.string().min(3).max(500),
});

router.post(
  "/:id/reject",
  authenticate,
  requirePermission("voice_intake:approve"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = rejectSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", details: parsed.error.format() });
      return;
    }
    try {
      await rejectIntake({
        callId: param(req.params.id),
        actorId: req.user!.id,
        reason: parsed.data.reason,
      });
      res.json({ ok: true });
    } catch (err) {
      logger.error("voice-intake reject failed", { error: (err as Error).message });
      res.status(500).json({ error: "Failed to reject voice intake" });
    }
  }
);

router.post(
  "/:id/callback",
  authenticate,
  requirePermission("voice_intake:view"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const id = param(req.params.id);
      await query(
        `UPDATE voice_intake_calls SET callback_requested = TRUE, updated_at = NOW() WHERE id = $1`,
        [id]
      );
      res.json({ ok: true });
    } catch (err) {
      logger.error("voice-intake callback toggle failed", { error: (err as Error).message });
      res.status(500).json({ error: "Failed to flag callback" });
    }
  }
);

export default router;
