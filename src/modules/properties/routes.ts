import { Router } from "express";
import { z } from "zod";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { requirePermission } from "../../middleware/rbac";
import {
  PropertyService,
  AMI_TIER_ORDER,
  BEDROOM_FILTERS,
  AVAILABILITY_FILTERS,
} from "./service";
import { logger } from "../../utils/logger";

const router = Router();
const service = new PropertyService();

const extendedFields = {
  phone: z.string().max(20).optional(),
  email: z.string().email().max(255).optional(),
  propertyManager: z.string().max(200).optional(),
  propertyType: z.enum(["senior", "family", "mixed_use"]).optional(),
  lihtcType: z.string().max(50).optional(),
  amiSetAside: z.string().max(100).optional(),
  compliancePeriodStart: z.string().optional(),
  compliancePeriodEnd: z.string().optional(),
  hasLura: z.boolean().optional(),
  hasMortgage: z.boolean().optional(),
  jurisdiction: z.string().max(100).optional(),
  unitMix: z.record(z.string(), z.number()).optional(),
  rentSchedule: z.record(z.string(), z.number()).optional(),
  totalVacancy: z.number().int().min(0).optional(),
  waitingListEnabled: z.boolean().optional(),
};

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
  ...extendedFields,
});

const UpdatePropertySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  addressLine2: z.string().max(255).optional(),
  unitCount: z.number().int().positive().optional(),
  amiArea: z.string().min(1).max(100).optional(),
  onesitePropertyId: z.string().max(100).optional(),
  loftPropertyId: z.string().max(100).optional(),
  ...extendedFields,
});

/**
 * GET /api/properties
 *
 * List properties. Always returns a per-property `availability` rollup so
 * browse surfaces ("3 available", "Fully leased") don't need a second
 * round-trip per tile.
 *
 * Optional query params (mirror `applicants/units?amiTier=` semantics so the
 * browse surface and the apply funnel agree on what an applicant qualifies
 * for):
 *   ?amiTier=30|50|60|80         — narrow to set-asides ≥ applicant's tier
 *   ?bedroom=studio|1|2|3        — at least one available unit at that size
 *                                  ("3" is inclusive of 3BR+)
 *   ?availability=available_now  — drop fully leased / fully held properties
 *
 * Invalid values return 400 with `{ error, allowed }` so a typo (e.g.
 * `?amiTier=70`) is a loud failure rather than a silent "full list" surprise.
 *
 * Public read: property listings are marketing surfaces (the gpmglv tier of
 * affordable-housing operator publishes the same data on its homepage) and
 * /discover renders this anonymously. Create / update / delete on this
 * router remain gated by `authenticate` + role-scoped permissions.
 */
router.get(
  "/",
  async (req: AuthRequest, res) => {
    try {
      // Zod-validate query params with a 400 contract that matches PR #69's
      // applicants/units?amiTier=: error + allowed[] so the client can show a
      // useful message and CI can assert against a stable shape.
      if (req.query.amiTier !== undefined) {
        const parsed = z.enum(AMI_TIER_ORDER).safeParse(req.query.amiTier);
        if (!parsed.success) {
          res.status(400).json({
            error: "Invalid amiTier",
            allowed: AMI_TIER_ORDER,
          });
          return;
        }
      }
      if (req.query.bedroom !== undefined) {
        const parsed = z.enum(BEDROOM_FILTERS).safeParse(req.query.bedroom);
        if (!parsed.success) {
          res.status(400).json({
            error: "Invalid bedroom",
            allowed: BEDROOM_FILTERS,
          });
          return;
        }
      }
      if (req.query.availability !== undefined) {
        const parsed = z.enum(AVAILABILITY_FILTERS).safeParse(req.query.availability);
        if (!parsed.success) {
          res.status(400).json({
            error: "Invalid availability",
            allowed: AVAILABILITY_FILTERS,
          });
          return;
        }
      }

      const properties = await service.listWithAvailability({
        amiTier: req.query.amiTier as (typeof AMI_TIER_ORDER)[number] | undefined,
        bedroom: req.query.bedroom as (typeof BEDROOM_FILTERS)[number] | undefined,
        availability: req.query.availability as
          | (typeof AVAILABILITY_FILTERS)[number]
          | undefined,
      });
      res.json({ properties, total: properties.length });
    } catch (err) {
      logger.error("Failed to list properties", { error: (err as Error).message });
      res.status(500).json({ error: "Failed to list properties" });
    }
  }
);

/**
 * GET /api/properties/:propertyId/availability
 *
 * Bedroom-grouped available units for a single property. Drives the
 * "Live availability" section on /property/:slug.
 *
 * Stale-held units (status='held' AND claim_expires_at < NOW()) are treated
 * as available so cron isn't required — matches the applicants/units route.
 *
 * Permission: property:view (all roles).
 */
router.get(
  "/:propertyId/availability",
  authenticate,
  requirePermission("property:view"),
  async (req: AuthRequest, res) => {
    try {
      const result = await service.getAvailability(req.params.propertyId as string);
      if (!result) {
        res.status(404).json({ error: "Property not found" });
        return;
      }
      res.json(result);
    } catch (err) {
      logger.error("Failed to get property availability", {
        error: (err as Error).message,
      });
      res.status(500).json({ error: "Failed to get property availability" });
    }
  }
);

/**
 * GET /api/properties/:propertyId/rent-range
 *
 * Wedge #9 — honest pricing + AMI tier disclosure. Returns the per-bedroom
 * rent range (min/max from the units table) along with the property's
 * canonical AMI set-aside (e.g. "60% AMI"). Buckets without units in that
 * bedroom are returned as null so the client can omit them cleanly.
 *
 * Permission: property:view (all roles).
 */
router.get(
  "/:propertyId/rent-range",
  authenticate,
  requirePermission("property:view"),
  async (req: AuthRequest, res) => {
    try {
      const result = await service.getRentRange(req.params.propertyId as string);
      if (!result) {
        res.status(404).json({ error: "Property not found" });
        return;
      }
      res.json(result);
    } catch (err) {
      logger.error("Failed to get property rent range", {
        error: (err as Error).message,
      });
      res.status(500).json({ error: "Failed to get property rent range" });
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
