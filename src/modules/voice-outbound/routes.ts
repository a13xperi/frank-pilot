/**
 * PM-console routes for outbound wait-list calling.
 *
 * Mount path: /api/pm/outbound-calls (flag: VOICE_OUTBOUND_ENABLED)
 *
 * Permissions reuse the voice-intake family on purpose — it's the same review
 * console and the same staff: leasing agents can SEE the queue
 * (voice_intake:view), only senior+ can import/propose/approve/dial
 * (voice_intake:approve).
 */

import { Router, Response } from "express";
import { z } from "zod";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { requirePermission } from "../../middleware/rbac";
import { query } from "../../config/database";
import { logger } from "../../utils/logger";
import { param } from "../../utils/params";
import { parseWaitlistCsv, type WaitlistImportRow } from "./csv";
import { dialQueueItem, importWaitlist, proposeCalls, reviewQueueItem } from "./service";

const router = Router();

// ── Import ──────────────────────────────────────────────────────────────────

const importEntrySchema = z.object({
  position: z.number().int().positive().nullish(),
  name: z.string().min(1),
  phone: z.string().nullish(),
  email: z.string().nullish(),
  bedrooms: z.number().int().min(0).max(9).nullish(),
  listedAt: z.string().nullish(),
  consent: z.boolean().default(false),
  consentSource: z.string().nullish(),
});

const importSchema = z
  .object({
    sourceLabel: z.string().min(3).max(200),
    propertyId: z.string().uuid().nullish(),
    entries: z.array(importEntrySchema).min(1).max(5000).optional(),
    csv: z.string().min(1).optional(),
  })
  .refine((body) => Boolean(body.entries?.length) !== Boolean(body.csv), {
    message: "provide exactly one of `entries` or `csv`",
  });

router.post(
  "/imports",
  authenticate,
  requirePermission("voice_intake:approve"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = importSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", details: parsed.error.format() });
      return;
    }
    try {
      let rows: WaitlistImportRow[];
      let csvErrors: string[] = [];
      if (parsed.data.csv) {
        const result = parseWaitlistCsv(parsed.data.csv);
        rows = result.rows;
        csvErrors = result.errors;
        if (rows.length === 0) {
          res.status(422).json({ error: "CSV produced no importable rows", details: csvErrors });
          return;
        }
      } else {
        rows = parsed.data.entries!.map((e) => ({
          position: e.position ?? null,
          name: e.name,
          phone: e.phone ?? null,
          email: e.email ?? null,
          bedrooms: e.bedrooms ?? null,
          listedAt: e.listedAt ?? null,
          consent: e.consent,
          consentSource: e.consentSource ?? null,
        }));
      }

      const result = await importWaitlist({
        sourceLabel: parsed.data.sourceLabel,
        propertyId: parsed.data.propertyId ?? null,
        importedBy: req.user!.id,
        rows,
      });
      res.status(201).json({ ...result, errors: [...csvErrors, ...result.errors] });
    } catch (err) {
      logger.error("waitlist import failed", { error: (err as Error).message });
      res.status(500).json({ error: "Failed to import wait list" });
    }
  }
);

router.get(
  "/imports/:id",
  authenticate,
  requirePermission("voice_intake:view"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const id = param(req.params.id);
      const batch = await query(`SELECT * FROM waitlist_import_batches WHERE id = $1`, [id]);
      if (!batch.rows[0]) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      const byStatus = await query(
        `SELECT status, COUNT(*)::int AS count
           FROM external_waitlist_entries WHERE batch_id = $1 GROUP BY status`,
        [id]
      );
      res.json({ batch: batch.rows[0], entriesByStatus: byStatus.rows });
    } catch (err) {
      logger.error("import detail failed", { error: (err as Error).message });
      res.status(500).json({ error: "Failed to load import batch" });
    }
  }
);

// ── Entries ─────────────────────────────────────────────────────────────────

const entriesQuerySchema = z.object({
  status: z
    .enum([
      "all",
      "pending",
      "queued",
      "contacted",
      "interested",
      "declined",
      "unreachable",
      "removal_review",
      "removed",
      "converted",
    ])
    .default("all"),
  propertyId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

router.get(
  "/entries",
  authenticate,
  requirePermission("voice_intake:view"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = entriesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid query", details: parsed.error.format() });
      return;
    }
    const { status, propertyId, limit, offset } = parsed.data;

    const where: string[] = [];
    const params: unknown[] = [];
    if (status !== "all") {
      params.push(status);
      where.push(`status = $${params.length}`);
    }
    if (propertyId) {
      params.push(propertyId);
      where.push(`property_id = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    params.push(limit, offset);

    try {
      const rows = await query(
        `SELECT id, batch_id, property_id, source_position, full_name, phone, email,
                bedroom_count, listed_at, consent_outbound, status, contact_attempts,
                first_contacted_at, last_contacted_at,
                response_window_expires_at, removal_window_expires_at,
                matched_application_id
           FROM external_waitlist_entries
           ${whereSql}
           ORDER BY source_position ASC
           LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );
      res.json({ entries: rows.rows });
    } catch (err) {
      logger.error("entries list failed", { error: (err as Error).message });
      res.status(500).json({ error: "Failed to list entries" });
    }
  }
);

// ── Queue ───────────────────────────────────────────────────────────────────

const proposeSchema = z.object({
  propertyId: z.string().uuid().nullish(),
  limit: z.number().int().min(1).max(100).default(20),
});

router.post(
  "/queue/propose",
  authenticate,
  requirePermission("voice_intake:approve"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = proposeSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", details: parsed.error.format() });
      return;
    }
    try {
      const result = await proposeCalls({
        propertyId: parsed.data.propertyId ?? null,
        limit: parsed.data.limit,
        actorId: req.user!.id,
      });
      res.json(result);
    } catch (err) {
      logger.error("queue propose failed", { error: (err as Error).message });
      res.status(500).json({ error: "Failed to propose calls" });
    }
  }
);

const queueQuerySchema = z.object({
  status: z
    .enum(["all", "proposed", "approved", "rejected", "dialing", "completed", "failed"])
    .default("proposed"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

router.get(
  "/queue",
  authenticate,
  requirePermission("voice_intake:view"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = queueQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid query", details: parsed.error.format() });
      return;
    }
    const { status, limit, offset } = parsed.data;
    const params: unknown[] = [];
    let whereSql = "";
    if (status !== "all") {
      params.push(status);
      whereSql = `WHERE q.status = $1`;
    }
    params.push(limit, offset);
    try {
      const rows = await query(
        `SELECT q.id, q.entry_id, q.status, q.attempt_number, q.consent_snapshot,
                q.scheduled_after, q.reviewed_by, q.reviewed_at, q.reject_reason,
                q.conversation_id, q.dial_result, q.dialed_at, q.created_at,
                e.full_name, e.phone, e.source_position, e.property_id, e.bedroom_count
           FROM outbound_call_queue q
           JOIN external_waitlist_entries e ON e.id = q.entry_id
           ${whereSql}
           ORDER BY e.source_position ASC, q.created_at ASC
           LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );
      res.json({ queue: rows.rows });
    } catch (err) {
      logger.error("queue list failed", { error: (err as Error).message });
      res.status(500).json({ error: "Failed to list queue" });
    }
  }
);

const rejectSchema = z.object({ reason: z.string().min(3).max(500) });

router.post(
  "/queue/:id/approve",
  authenticate,
  requirePermission("voice_intake:approve"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const result = await reviewQueueItem({
        queueId: param(req.params.id),
        decision: "approve",
        actorId: req.user!.id,
      });
      res.json(result);
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e.code === "BAD_QUEUE_STATE") {
        res.status(409).json({ error: "Queue item not found or not awaiting review" });
        return;
      }
      logger.error("queue approve failed", { error: e.message });
      res.status(500).json({ error: "Failed to approve queue item" });
    }
  }
);

router.post(
  "/queue/:id/reject",
  authenticate,
  requirePermission("voice_intake:approve"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = rejectSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", details: parsed.error.format() });
      return;
    }
    try {
      const result = await reviewQueueItem({
        queueId: param(req.params.id),
        decision: "reject",
        actorId: req.user!.id,
        reason: parsed.data.reason,
      });
      res.json(result);
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e.code === "BAD_QUEUE_STATE") {
        res.status(409).json({ error: "Queue item not found or not awaiting review" });
        return;
      }
      logger.error("queue reject failed", { error: e.message });
      res.status(500).json({ error: "Failed to reject queue item" });
    }
  }
);

router.post(
  "/queue/:id/dial",
  authenticate,
  requirePermission("voice_intake:approve"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const result = await dialQueueItem({
        queueId: param(req.params.id),
        actorId: req.user!.id,
      });
      if (!result.placed) {
        const codes: Record<string, number> = {
          not_approved: 409,
          no_consent: 403,
          no_phone: 422,
          outside_calling_hours: 422,
          dial_failed: 502,
        };
        res.status(codes[result.refused] ?? 400).json(result);
        return;
      }
      res.json(result);
    } catch (err) {
      logger.error("queue dial failed", { error: (err as Error).message });
      res.status(500).json({ error: "Failed to dial queue item" });
    }
  }
);

export default router;
