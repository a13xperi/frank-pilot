import { Router, Response } from "express";
import { z } from "zod";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { requirePermission } from "../../middleware/rbac";
import { LeaseRenewalService } from "./service";
import { logger } from "../../utils/logger";

const router = Router();
const service = new LeaseRenewalService();

router.get("/", authenticate, requirePermission("renewal:view"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const renewals = await service.list({
        status: req.query.status as string | undefined,
        propertyId: req.query.propertyId as string | undefined,
      });
      res.json({ renewals });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  }
);

router.get("/:id", authenticate, requirePermission("renewal:view"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const renewal = await service.getById(req.params.id as string);
      if (!renewal) { res.status(404).json({ error: "Not found" }); return; }
      res.json(renewal);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  }
);

const CreateSchema = z.object({
  applicationId: z.string().uuid(),
  proposedRent: z.number().positive(),
  proposedTermMonths: z.number().int().positive().optional(),
});

router.post("/", authenticate, requirePermission("renewal:manage"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() }); return; }
    try {
      const result = await service.generateOffer(
        parsed.data.applicationId, parsed.data.proposedRent, parsed.data.proposedTermMonths || 12,
        req.user!.id, req.user!.role
      );
      res.status(201).json(result);
    } catch (err: any) { res.status(400).json({ error: err.message }); }
  }
);

const RespondSchema = z.object({
  response: z.enum(["accept", "decline", "counter"]),
  counterRent: z.number().positive().optional(),
  counterTermMonths: z.number().int().positive().optional(),
});

router.post("/:id/respond", authenticate, requirePermission("renewal:manage"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = RespondSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() }); return; }
    try {
      await service.respond(
        req.params.id as string, parsed.data.response, req.user!.id, req.user!.role,
        parsed.data.counterRent, parsed.data.counterTermMonths
      );
      res.json({ success: true });
    } catch (err: any) { res.status(400).json({ error: err.message }); }
  }
);

router.post("/:id/approve", authenticate, requirePermission("renewal:manage"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      await service.approve(req.params.id as string, req.user!.id, req.user!.role);
      res.json({ success: true });
    } catch (err: any) { res.status(400).json({ error: err.message }); }
  }
);

router.post("/process", authenticate, requirePermission("user:manage"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const result = await service.processRenewalOffers();
      res.json(result);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  }
);

export default router;
