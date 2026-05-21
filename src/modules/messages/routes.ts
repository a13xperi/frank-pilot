import { Router, Request, Response } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { requirePermission } from "../../middleware/rbac";
import { buildPropertyScope } from "../../middleware/scope";
import { query } from "../../config/database";
import { MessagesService } from "./service";
import { logger } from "../../utils/logger";
import { param } from "../../utils/params";

const router: Router = Router();
const service = new MessagesService();

const bodySchema = z.object({
  body: z.string().trim().min(1).max(4000),
});

// Per-user limiters for the authenticated messaging surface. Keyed on the
// authenticated user id (populated by `authenticate`); falls back to a shared
// "anon" bucket if the limiter ever runs before auth (defensive — the chain
// below always runs authenticate first).
const userKey = (req: Request): string => (req as AuthRequest).user?.id ?? "anon";

// Posting a message — tighter cap to mitigate spam from a single account.
const messageWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  keyGenerator: userKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, slow down" },
});

// Marking a message read — looser, because the staff UI auto-fires this on
// view of unread applicant/tenant messages.
const messageReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: userKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, slow down" },
});

/**
 * Resolve property scope for a single application — staff may only see/post
 * messages on applications whose property is in their property_ids (unless
 * they are a global-scope role).
 *
 * Returns true if access allowed (response untouched), false after writing
 * a 403/404 to res.
 */
async function assertStaffCanAccessApplication(
  req: AuthRequest,
  res: Response,
  applicationId: string
): Promise<boolean> {
  const params: unknown[] = [applicationId];
  const scope = buildPropertyScope(req, 2, "a.property_id");
  if (scope.denyAll) {
    res.status(403).json({ error: "Application not accessible" });
    return false;
  }
  let sql = "SELECT 1 FROM applications a WHERE a.id = $1";
  if (scope.sql) {
    sql += ` AND ${scope.sql}`;
    params.push(scope.param);
  }
  const result = await query(sql, params);
  if (result.rows.length === 0) {
    res.status(403).json({ error: "Application not accessible" });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------
// GET /api/applications/:id/messages — staff list view
// ---------------------------------------------------------------
router.get(
  "/:id/messages",
  authenticate,
  requirePermission("application:read"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const applicationId = param(req.params.id);
      if (!(await assertStaffCanAccessApplication(req, res, applicationId))) return;

      const messages = await service.listForApplication(applicationId);
      res.json({ messages });
    } catch (err) {
      logger.error("staff messages list failed", { error: (err as Error).message });
      res.status(500).json({ error: "Failed to load messages" });
    }
  }
);

// ---------------------------------------------------------------
// POST /api/applications/:id/messages — staff reply
// ---------------------------------------------------------------
router.post(
  "/:id/messages",
  authenticate,
  messageWriteLimiter,
  requirePermission("application:read"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const applicationId = param(req.params.id);
      if (!(await assertStaffCanAccessApplication(req, res, applicationId))) return;

      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: "Validation failed", details: parsed.error.errors });
        return;
      }

      const message = await service.create({
        applicationId,
        senderUserId: req.user!.id,
        senderRole: "staff",
        body: parsed.data.body,
      });
      res.status(201).json({ message });
    } catch (err) {
      logger.error("staff message create failed", { error: (err as Error).message });
      res.status(500).json({ error: "Failed to send message" });
    }
  }
);

// ---------------------------------------------------------------
// POST /api/applications/:id/messages/:msgId/read — staff marks unread
// applicant/tenant message as read
// ---------------------------------------------------------------
router.post(
  "/:id/messages/:msgId/read",
  authenticate,
  messageReadLimiter,
  requirePermission("application:read"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const applicationId = param(req.params.id);
      const messageId = param(req.params.msgId);
      if (!(await assertStaffCanAccessApplication(req, res, applicationId))) return;

      const ok = await service.markRead({
        applicationId,
        messageId,
        readerUserId: req.user!.id,
        readerRole: "staff",
      });
      res.json({ updated: ok });
    } catch (err) {
      logger.error("staff message mark-read failed", { error: (err as Error).message });
      res.status(500).json({ error: "Failed to mark message read" });
    }
  }
);

export default router;
