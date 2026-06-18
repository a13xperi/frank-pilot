import { Router, Response } from "express";
import { z } from "zod";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { requirePermission } from "../../middleware/rbac";
import { callerCanAccessProperty } from "../../middleware/scope";
import { MaintenanceService, CompletionGateError, ATTACHMENT_KINDS } from "./service";

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
  propertyId: z.string().guid(),
  title: z.string().min(1),
  description: z.string().min(1),
  priority: z.enum(["emergency", "urgent", "routine", "low"]),
  unitNumber: z.string().optional(),
  applicationId: z.string().guid().optional(),
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

const AssignSchema = z.object({ assignedTo: z.string().guid() });

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
    } catch (err: any) {
      // The geolocated-completion-photo gate surfaces as a 422 with a stable
      // machine-readable code so the tech UI can keep the form open and prompt
      // for the photo, rather than treating it as a generic 400.
      if (err instanceof CompletionGateError) {
        res.status(422).json({ error: err.message, code: err.code });
        return;
      }
      res.status(400).json({ error: err.message });
    }
  }
);

// ── Attachments (D2: geolocated completion-photo evidence) ──────────────────
// Upload accepts a stored-image reference (object-storage URL or a data: URL on
// the demo/PWA path) plus optional geo + capture time. We never receive raw
// binary here — the body is JSON, bounded by the app-level 1mb express.json
// limit. A `completion_photo` SHOULD carry lat/long; only such photos satisfy
// the completion gate, but we accept geo-less photos of other kinds.
const AttachmentSchema = z.object({
  url: z.string().min(1).max(2_000_000), // generous: covers small data: URLs
  kind: z.enum(ATTACHMENT_KINDS),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  takenAt: z.string().datetime().optional(),
});

router.post("/:id/attachments", authenticate, requirePermission("maintenance:manage"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = AttachmentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }
    try {
      const result = await service.addAttachment(
        req.params.id as string,
        {
          url: parsed.data.url,
          kind: parsed.data.kind,
          latitude: parsed.data.latitude,
          longitude: parsed.data.longitude,
          takenAt: parsed.data.takenAt,
        },
        req.user!.id, req.user!.role
      );
      res.status(201).json(result);
    } catch (err: any) { res.status(400).json({ error: err.message }); }
  }
);

router.get("/:id/attachments", authenticate, requirePermission("maintenance:view"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const attachments = await service.getAttachments(req.params.id as string);
      res.json({ attachments });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
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
