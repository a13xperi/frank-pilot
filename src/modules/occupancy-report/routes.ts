import { Router, Response } from "express";
import { z } from "zod";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { requirePermission } from "../../middleware/rbac";
import { OccupancyService } from "./service";
import { logger } from "../../utils/logger";

const router = Router();
const service = new OccupancyService();

const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const today = (): string => new Date().toISOString().slice(0, 10);
const asOfFrom = (raw: unknown): string => (DateStr.safeParse(raw).success ? (raw as string) : today());

// Live occupancy — all properties, or one via ?propertyId=. No persistence.
router.get(
  "/live",
  authenticate,
  requirePermission("occupancy:view"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const asOf = asOfFrom(req.query.asOf);
    try {
      if (req.query.propertyId) {
        const one = await service.computeForProperty(req.query.propertyId as string, asOf);
        if (!one) {
          res.status(404).json({ error: "Property not found" });
          return;
        }
        res.json(one);
        return;
      }
      res.json({ asOf, properties: await service.computeAll(asOf) });
    } catch (err) {
      logger.error("Failed to compute occupancy", { error: (err as Error).message });
      res.status(500).json({ error: "Failed to compute occupancy" });
    }
  },
);

// Persisted point-in-time snapshots (the audit-binder record).
router.get(
  "/snapshots",
  authenticate,
  requirePermission("occupancy:view"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      res.json(
        await service.listSnapshots({
          propertyId: req.query.propertyId as string | undefined,
          asOf: req.query.asOf as string | undefined,
        }),
      );
    } catch (err) {
      logger.error("Failed to list occupancy snapshots", { error: (err as Error).message });
      res.status(500).json({ error: "Failed to list snapshots" });
    }
  },
);

const SnapshotSchema = z.object({ asOf: DateStr.optional() });

// Compute + persist a snapshot for every property (idempotent per as-of date).
router.post(
  "/snapshots",
  authenticate,
  requirePermission("occupancy:manage"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = SnapshotSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }
    try {
      const asOf = parsed.data.asOf ?? today();
      res.status(201).json({ asOf, snapshots: await service.snapshotAll(asOf, req.user!.id) });
    } catch (err) {
      logger.error("Failed to record occupancy snapshots", { error: (err as Error).message });
      res.status(400).json({ error: (err as Error).message });
    }
  },
);

export default router;
