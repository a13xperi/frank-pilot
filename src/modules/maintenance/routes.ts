import { Router, Response } from "express";
import { z } from "zod";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { requirePermission } from "../../middleware/rbac";
import { callerCanAccessProperty } from "../../middleware/scope";
import { MaintenanceService } from "./service";

const router = Router();
const service = new MaintenanceService();

router.get("/", authenticate, requirePermission("maintenance:view"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const result = await service.list({
        propertyId: req.query.propertyId as string | undefined,
        status: req.query.status as string | undefined,
        priority: req.query.priority as string | undefined,
        isEmergency: req.query.isEmergency === "true" ? true : undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
      }, req);
      res.json(result);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  }
);

router.get("/:id", authenticate, requirePermission("maintenance:view"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const wo = await service.getById(req.params.id as string, req);
      if (!wo) { res.status(404).json({ error: "Not found" }); return; }
      res.json(wo);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  }
);

const CreateSchema = z.object({
  propertyId: z.string().uuid(),
  title: z.string().min(1),
  description: z.string().min(1),
  priority: z.enum(["emergency", "urgent", "routine", "low"]),
  unitNumber: z.string().optional(),
  applicationId: z.string().uuid().optional(),
  category: z.string().optional(),
});

router.post("/", authenticate, requirePermission("maintenance:manage"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() }); return; }
    // Block cross-property creation for scoped roles (global roles pass through)
    if (!callerCanAccessProperty(req, parsed.data.propertyId)) {
      res.status(403).json({ error: "Property not accessible" }); return;
    }
    try {
      const result = await service.createWorkOrder(
        parsed.data.propertyId, parsed.data.title, parsed.data.description, parsed.data.priority,
        req.user!.id, req.user!.role, parsed.data.unitNumber, parsed.data.applicationId, parsed.data.category
      );
      res.status(201).json(result);
    } catch (err: any) { res.status(400).json({ error: err.message }); }
  }
);

const AssignSchema = z.object({ assignedTo: z.string().uuid() });

router.post("/:id/assign", authenticate, requirePermission("maintenance:manage"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = AssignSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Validation failed" }); return; }
    try {
      await service.assign(req.params.id as string, parsed.data.assignedTo, req.user!.id, req.user!.role);
      res.json({ success: true });
    } catch (err: any) { res.status(400).json({ error: err.message }); }
  }
);

router.post("/:id/start", authenticate, requirePermission("maintenance:manage"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      await service.startWork(req.params.id as string);
      res.json({ success: true });
    } catch (err: any) { res.status(400).json({ error: err.message }); }
  }
);

const CompleteSchema = z.object({
  notes: z.string().min(1),
  actualCost: z.number().min(0).optional(),
});

router.post("/:id/complete", authenticate, requirePermission("maintenance:manage"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = CompleteSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Validation failed" }); return; }
    try {
      await service.complete(req.params.id as string, req.user!.id, req.user!.role, parsed.data.notes, parsed.data.actualCost);
      res.json({ success: true });
    } catch (err: any) { res.status(400).json({ error: err.message }); }
  }
);

router.post("/:id/cancel", authenticate, requirePermission("maintenance:manage"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      await service.cancel(req.params.id as string);
      res.json({ success: true });
    } catch (err: any) { res.status(400).json({ error: err.message }); }
  }
);

export default router;
