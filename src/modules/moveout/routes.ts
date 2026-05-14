import { Router, Response } from "express";
import { z } from "zod";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { requirePermission } from "../../middleware/rbac";
import { MoveOutService } from "./service";
import { logger } from "../../utils/logger";

const router = Router();
const service = new MoveOutService();

router.get("/", authenticate, requirePermission("moveout:view"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const moveOuts = await service.list({
        status: req.query.status as string | undefined,
        propertyId: req.query.propertyId as string | undefined,
      }, req);
      res.json({ moveOuts });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  }
);

router.get("/deadlines", authenticate, requirePermission("moveout:view"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const deadlines = await service.getDeadlines(req);
      res.json({ deadlines });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  }
);

router.get("/:id", authenticate, requirePermission("moveout:view"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const moveOut = await service.getById(req.params.id as string, req);
      if (!moveOut) { res.status(404).json({ error: "Not found" }); return; }
      res.json(moveOut);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  }
);

const InitiateSchema = z.object({
  applicationId: z.string().uuid(),
  noticeDate: z.string(),
  forwardingAddress: z.string().min(1, "Forwarding address is required"),
});

router.post("/", authenticate, requirePermission("moveout:manage"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = InitiateSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() }); return; }
    try {
      const result = await service.initiate(
        parsed.data.applicationId, parsed.data.noticeDate, parsed.data.forwardingAddress,
        req.user!.id, req.user!.role
      );
      res.status(201).json(result);
    } catch (err: any) { res.status(400).json({ error: err.message }); }
  }
);

const InspectionSchema = z.object({
  inspectionType: z.enum(["pre", "final"]),
  notes: z.string().min(1),
});

router.post("/:id/inspection", authenticate, requirePermission("moveout:manage"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = InspectionSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() }); return; }
    try {
      await service.recordInspection(
        req.params.id as string, parsed.data.inspectionType, parsed.data.notes,
        req.user!.id, req.user!.role
      );
      res.json({ success: true });
    } catch (err: any) { res.status(400).json({ error: err.message }); }
  }
);

const DepositSchema = z.object({
  deductions: z.record(z.string(), z.number().min(0)),
});

router.post("/:id/deposit", authenticate, requirePermission("moveout:manage"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = DepositSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() }); return; }
    try {
      const result = await service.calculateDeposit(
        req.params.id as string, parsed.data.deductions, req.user!.id, req.user!.role
      );
      res.json(result);
    } catch (err: any) { res.status(400).json({ error: err.message }); }
  }
);

router.post("/:id/refund", authenticate, requirePermission("moveout:manage"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      await service.sendRefund(req.params.id as string, req.user!.id, req.user!.role);
      res.json({ success: true });
    } catch (err: any) { res.status(400).json({ error: err.message }); }
  }
);

export default router;
