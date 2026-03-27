import { Router } from "express";
import { z } from "zod";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { requirePermission } from "../../middleware/rbac";
import { PropertyService } from "./service";
import { logger } from "../../utils/logger";

const router = Router();
const service = new PropertyService();

const CreatePropertySchema = z.object({
  name: z.string().min(1).max(255),
  addressLine1: z.string().min(1).max(255),
  addressLine2: z.string().max(255).optional(),
  city: z.string().min(1).max(100),
  state: z.string().length(2, "State must be a 2-character code"),
  zip: z.string().min(5).max(10),
  unitCount: z.number().int().positive(),
  amiArea: z.string().min(1).max(100),
  onesitePropertyId: z.string().max(100).optional(),
  loftPropertyId: z.string().max(100).optional(),
});

const UpdatePropertySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  addressLine2: z.string().max(255).optional(),
  unitCount: z.number().int().positive().optional(),
  amiArea: z.string().min(1).max(100).optional(),
  onesitePropertyId: z.string().max(100).optional(),
  loftPropertyId: z.string().max(100).optional(),
});

/**
 * GET /api/properties
 * List all properties.
 * Permission: property:view (all roles including leasing_agent)
 */
router.get(
  "/",
  authenticate,
  requirePermission("property:view"),
  async (_req: AuthRequest, res) => {
    try {
      const properties = await service.list();
      res.json({ properties, total: properties.length });
    } catch (err) {
      logger.error("Failed to list properties", { error: (err as Error).message });
      res.status(500).json({ error: "Failed to list properties" });
    }
  }
);

/**
 * GET /api/properties/:propertyId
 * Get a single property.
 * Permission: property:view (all roles)
 */
router.get(
  "/:propertyId",
  authenticate,
  requirePermission("property:view"),
  async (req: AuthRequest, res) => {
    try {
      const property = await service.getById(req.params.propertyId as string);
      if (!property) {
        res.status(404).json({ error: "Property not found" });
        return;
      }
      res.json(property);
    } catch (err) {
      logger.error("Failed to get property", { error: (err as Error).message });
      res.status(500).json({ error: "Failed to get property" });
    }
  }
);

/**
 * POST /api/properties
 * Create a new property.
 * Permission: property:manage (asset_manager, system_admin)
 */
router.post(
  "/",
  authenticate,
  requirePermission("property:manage"),
  async (req: AuthRequest, res) => {
    const parsed = CreatePropertySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Validation failed",
        details: parsed.error.flatten(),
      });
      return;
    }

    try {
      const property = await service.create(parsed.data, req.user!.id, req.user!.role);
      res.status(201).json(property);
    } catch (err) {
      logger.error("Failed to create property", { error: (err as Error).message });
      res.status(400).json({ error: (err as Error).message });
    }
  }
);

/**
 * PATCH /api/properties/:propertyId
 * Update mutable property fields.
 * Note: addressLine1, city, state, zip are immutable — coordinate changes with OneSite.
 * Permission: property:manage (asset_manager, system_admin)
 */
router.patch(
  "/:propertyId",
  authenticate,
  requirePermission("property:manage"),
  async (req: AuthRequest, res) => {
    const parsed = UpdatePropertySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Validation failed",
        details: parsed.error.flatten(),
      });
      return;
    }

    try {
      const property = await service.update(
        req.params.propertyId as string,
        parsed.data,
        req.user!.id,
        req.user!.role
      );
      res.json(property);
    } catch (err) {
      logger.error("Failed to update property", { error: (err as Error).message });
      res.status(400).json({ error: (err as Error).message });
    }
  }
);

export default router;
