import { Router, Response } from "express";
import { z } from "zod";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { requirePermission } from "../../middleware/rbac";
import { callerCanAccessProperty } from "../../middleware/scope";
import { InspectionService } from "./service";

const router = Router();
const service = new InspectionService();

router.get("/", authenticate, requirePermission("inspection:view"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const result = await service.list({
        propertyId: req.query.propertyId as string | undefined,
        status: req.query.status as string | undefined,
        inspectionType: req.query.inspectionType as string | undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
      }, req);
      res.json(result);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  }
);

router.get("/overdue", authenticate, requirePermission("inspection:view"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const inspections = await service.getOverdue(req);
      res.json({ inspections });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  }
);

router.get("/:id", authenticate, requirePermission("inspection:view"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const inspection = await service.getById(req.params.id as string, req);
      if (!inspection) { res.status(404).json({ error: "Not found" }); return; }
      res.json(inspection);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  }
);

const ScheduleSchema = z.object({
  propertyId: z.string().uuid(),
  inspectionType: z.string().min(1),
  scheduledDate: z.string(),
  unitNumber: z.string().optional(),
  applicationId: z.string().uuid().optional(),
});

router.post("/", authenticate, requirePermission("inspection:manage"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = ScheduleSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() }); return; }
    if (!callerCanAccessProperty(req, parsed.data.propertyId)) {
      res.status(403).json({ error: "Property not accessible" }); return;
    }
    try {
      const result = await service.schedule(
        parsed.data.propertyId, parsed.data.inspectionType, parsed.data.scheduledDate,
        req.user!.id, req.user!.role, parsed.data.unitNumber, parsed.data.applicationId
      );
      res.status(201).json(result);
    } catch (err: any) { res.status(400).json({ error: err.message }); }
  }
);

const CompleteSchema = z.object({
  notes: z.string().optional(),
  roomDetails: z.record(z.string(), z.unknown()).optional(),
  smokeDetectorOk: z.boolean().optional(),
  hqsCompliant: z.boolean().optional(),
  followUpRequired: z.boolean().optional(),
  followUpNotes: z.string().optional(),
});

router.post("/:id/complete", authenticate, requirePermission("inspection:manage"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = CompleteSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Validation failed" }); return; }
    try {
      await service.complete(req.params.id as string, req.user!.id, req.user!.role, parsed.data);
      res.json({ success: true });
    } catch (err: any) { res.status(400).json({ error: err.message }); }
  }
);

router.post("/:id/cancel", authenticate, requirePermission("inspection:manage"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      await service.cancel(req.params.id as string);
      res.json({ success: true });
    } catch (err: any) { res.status(400).json({ error: err.message }); }
  }
);

export default router;
