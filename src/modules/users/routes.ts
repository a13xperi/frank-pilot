import { Router } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { requirePermission } from "../../middleware/rbac";
import { writeAuditLog } from "../../middleware/audit";
import { createMagicLink, logMagicLink, sendMagicLink } from "../auth/magic-link-service";
import { UserService } from "./service";
import { logger } from "../../utils/logger";

const router = Router();
const service = new UserService();

// Wedge #10: tenants/applicants authenticate via magic-link, so a "password
// reset" for them is operationally a fresh sign-in link to their proven email.
// Keyed on the authenticated user id (populated by `authenticate`), 3/min is
// generous for a real human clicking a button and tight enough to prevent a
// hijacked token from blasting their inbox.
const passwordResetEmailLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3,
  keyGenerator: (req) => (req as AuthRequest).user?.id ?? "anon",
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, try again in a minute" },
});

const PasswordResetEmailSchema = z.object({}).strict();

const CreateUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  role: z.enum([
    "leasing_agent",
    "senior_manager",
    "regional_manager",
    "asset_manager",
    "system_admin",
  ]),
  propertyIds: z.array(z.string().guid()).optional(),
});

const ResetPasswordSchema = z.object({
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
});

/**
 * GET /api/users
 * List all staff users. Optional query params: role, isActive.
 * Permission: user:view (senior_manager+)
 */
router.get(
  "/",
  authenticate,
  requirePermission("user:view"),
  async (req: AuthRequest, res) => {
    try {
      const filters: { role?: string; isActive?: boolean } = {};
      if (req.query.role) filters.role = req.query.role as string;
      if (req.query.isActive !== undefined) {
        filters.isActive = req.query.isActive === "true";
      }

      const users = await service.list(filters);
      res.json({ users, total: users.length });
    } catch (err) {
      logger.error("Failed to list users", { error: (err as Error).message });
      res.status(500).json({ error: "Failed to list users" });
    }
  }
);

/**
 * GET /api/users/signup-stats
 * Top-of-funnel counts from the tenant onboarding app: how many people have
 * registered (applicant/tenant role) and how many have a verified email.
 * Feeds the "Signups" stat card on the management Dashboard.
 * Permission: user:view (senior_manager+)
 *
 * Declared before GET /:userId so the literal path isn't captured as an id.
 */
router.get(
  "/signup-stats",
  authenticate,
  requirePermission("user:view"),
  async (_req: AuthRequest, res) => {
    try {
      const stats = await service.signupStats();
      res.json(stats);
    } catch (err) {
      logger.error("Failed to load signup stats", { error: (err as Error).message });
      res.status(500).json({ error: "Failed to load signup stats" });
    }
  }
);

/**
 * GET /api/users/:userId
 * Get a single user by ID.
 * Permission: user:view (senior_manager+)
 */
router.get(
  "/:userId",
  authenticate,
  requirePermission("user:view"),
  async (req: AuthRequest, res) => {
    try {
      const user = await service.getById(req.params.userId as string);
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      res.json(user);
    } catch (err) {
      logger.error("Failed to get user", { error: (err as Error).message });
      res.status(500).json({ error: "Failed to get user" });
    }
  }
);

/**
 * POST /api/users
 * Create a new staff user.
 * Permission: user:manage (system_admin only)
 */
router.post(
  "/",
  authenticate,
  requirePermission("user:manage"),
  async (req: AuthRequest, res) => {
    const parsed = CreateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Validation failed",
        details: parsed.error.flatten(),
      });
      return;
    }

    try {
      const user = await service.create(parsed.data, req.user!.id, req.user!.role);
      res.status(201).json(user);
    } catch (err) {
      logger.error("Failed to create user", { error: (err as Error).message });
      res.status(400).json({ error: (err as Error).message });
    }
  }
);

/**
 * PATCH /api/users/:userId/deactivate
 * Deactivate a user account (blocks login).
 * Permission: user:manage (system_admin only)
 */
router.patch(
  "/:userId/deactivate",
  authenticate,
  requirePermission("user:manage"),
  async (req: AuthRequest, res) => {
    try {
      const user = await service.setActive(
        req.params.userId as string,
        false,
        req.user!.id,
        req.user!.role
      );
      res.json(user);
    } catch (err) {
      logger.error("Failed to deactivate user", { error: (err as Error).message });
      res.status(400).json({ error: (err as Error).message });
    }
  }
);

/**
 * PATCH /api/users/:userId/activate
 * Reactivate a previously deactivated user account.
 * Permission: user:manage (system_admin only)
 */
router.patch(
  "/:userId/activate",
  authenticate,
  requirePermission("user:manage"),
  async (req: AuthRequest, res) => {
    try {
      const user = await service.setActive(
        req.params.userId as string,
        true,
        req.user!.id,
        req.user!.role
      );
      res.json(user);
    } catch (err) {
      logger.error("Failed to activate user", { error: (err as Error).message });
      res.status(400).json({ error: (err as Error).message });
    }
  }
);

/**
 * POST /api/users/:userId/reset-password
 * Admin password reset — no old password required.
 * Permission: user:manage (system_admin only)
 */
router.post(
  "/:userId/reset-password",
  authenticate,
  requirePermission("user:manage"),
  async (req: AuthRequest, res) => {
    const parsed = ResetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Validation failed",
        details: parsed.error.flatten(),
      });
      return;
    }

    try {
      await service.resetPassword(
        req.params.userId as string,
        parsed.data.newPassword,
        req.user!.id,
        req.user!.role
      );
      res.json({ success: true, message: "Password reset successfully" });
    } catch (err) {
      logger.error("Failed to reset password", { error: (err as Error).message });
      res.status(400).json({ error: (err as Error).message });
    }
  }
);

/**
 * POST /api/users/me/password-reset-email
 * Wedge #10 — tenant-facing self-serve "password reset".
 *
 * Architectural call (choice B): tenants and applicants don't have a password
 * hash to "current-verify" against — `users.password_hash` is nullable for
 * magic-link-only accounts. So the canonical reset surface is to fire a fresh
 * magic-link to the authenticated user's already-proven email. Same primitive
 * the Login + Apply flows use, just initiated from inside an authenticated
 * session (e.g. a "lost my device, sign me in again" affordance).
 *
 * Contract:
 *   - 204 on success — body is empty, link is delivered out-of-band via email.
 *   - 400 if the request body has stray properties (zod .strict).
 *   - 401 if no JWT is present (handled by `authenticate`).
 *   - 403 if the caller is a staff role — staff log in by password, not magic
 *     link. They should use the admin reset endpoint instead.
 *   - 429 if the per-user rate limit trips.
 *
 * No email is taken from the request body — the only address we'd ever send to
 * is the authenticated user's own. That closes any "reset someone else's"
 * vector and keeps the JWT subject as the sole authority.
 */
router.post(
  "/me/password-reset-email",
  authenticate,
  passwordResetEmailLimiter,
  async (req: AuthRequest, res) => {
    // Reject unexpected body keys defensively — the schema is intentionally
    // empty because the only input is the JWT subject.
    const parsed = PasswordResetEmailSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: "Validation failed",
        details: parsed.error.flatten(),
      });
      return;
    }

    const user = req.user!;

    // Staff use the admin reset endpoint (which requires a new password).
    // createMagicLink would short-circuit anyway, but bail explicitly so the
    // caller gets a precise 403 instead of a misleading 204.
    if (!["applicant", "tenant"].includes(user.role)) {
      res.status(403).json({
        error: "Magic-link reset is only for tenants and applicants",
      });
      return;
    }

    try {
      const link = await createMagicLink(user.email);

      // createMagicLink returns null for inactive users or staff. The
      // authenticate middleware already filtered out inactive users, and the
      // role check above filtered staff, so this branch should be unreachable
      // in practice — but stay 204 either way to keep the contract simple.
      if (link) {
        logMagicLink(user.email, link.link);
        sendMagicLink(user.email, link.link, { firstName: user.firstName });
      }

      await writeAuditLog({
        action: "permission_change",
        actorId: user.id,
        actorRole: user.role,
        resourceType: "user",
        resourceId: user.id,
        details: {
          action: "tenant_password_reset_email_requested",
          targetEmail: user.email,
        },
      });

      res.status(204).end();
    } catch (err) {
      logger.error("Failed to send tenant password-reset email", {
        error: (err as Error).message,
        userId: user.id,
      });
      res.status(500).json({ error: "Failed to send reset email" });
    }
  }
);

export default router;
