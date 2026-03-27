import { Router } from "express";
import { z } from "zod";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { requirePermission } from "../../middleware/rbac";
import { UserService } from "./service";
import { logger } from "../../utils/logger";

const router = Router();
const service = new UserService();

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
  propertyIds: z.array(z.string().uuid()).optional(),
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

export default router;
