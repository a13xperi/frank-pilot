import { Router, Response } from "express";
import { z } from "zod";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { requirePermission } from "../../middleware/rbac";
import { RecertificationService } from "./service";
import { RecertComplianceService } from "../acquisitions/recert-compliance";
import { Form8823Service, summarizeForm8823 } from "./form-8823";
import { logger } from "../../utils/logger";

const router = Router();
const service = new RecertificationService();
const compliance = new RecertComplianceService();
const form8823 = new Form8823Service();

// List recertifications with filters
router.get(
  "/",
  authenticate,
  requirePermission("recertification:view"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const result = await service.list({
        status: req.query.status as string | undefined,
        propertyId: req.query.propertyId as string | undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
        offset: req.query.offset ? parseInt(req.query.offset as string) : undefined,
      }, req);
      res.json(result);
    } catch (err: any) {
      logger.error("Failed to list recertifications", { error: err.message });
      res.status(500).json({ error: "Failed to list recertifications" });
    }
  }
);

// Upcoming recertifications (due within N days)
router.get(
  "/upcoming",
  authenticate,
  requirePermission("recertification:view"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const days = req.query.days ? parseInt(req.query.days as string) : 60;
      const recertifications = await service.getUpcoming(days, req);
      res.json({ recertifications });
    } catch (err: any) {
      logger.error("Failed to get upcoming recertifications", { error: err.message });
      res.status(500).json({ error: "Failed to get upcoming recertifications" });
    }
  }
);

// Form 8823 export — out-of-compliance recerts assembled into the IRS
// noncompliance-report data shape (optionally CSV-summary). Read-only.
// MUST be registered before "/:id" so the literal path isn't captured as an id.
router.get(
  "/form-8823",
  authenticate,
  requirePermission("recertification:view"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const report = await form8823.assemble({
        propertyId: req.query.propertyId as string | undefined,
        includeCorrected: req.query.includeCorrected === "true",
        withEvidence: req.query.withEvidence !== "false",
      });
      if (req.query.format === "csv") {
        const lines = ["bin | property | unit | category | state | date_identified",
          ...summarizeForm8823(report)];
        res.setHeader("content-type", "text/csv; charset=utf-8");
        res.setHeader("content-disposition", 'attachment; filename="form-8823.csv"');
        res.send(lines.join("\n"));
        return;
      }
      res.json(report);
    } catch (err: any) {
      logger.error("Failed to assemble Form 8823 export", { error: err.message });
      res.status(500).json({ error: "Failed to assemble Form 8823 export" });
    }
  }
);

// Get single recertification
router.get(
  "/:id",
  authenticate,
  requirePermission("recertification:view"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const recert = await service.getById(req.params.id as string, req);
      if (!recert) {
        res.status(404).json({ error: "Recertification not found" });
        return;
      }
      res.json(recert);
    } catch (err: any) {
      logger.error("Failed to get recertification", { error: err.message });
      res.status(500).json({ error: "Failed to get recertification" });
    }
  }
);

// Income-ceiling check (QAP Phase 3.1): measure recertified income against the
// occupied unit's AMI designation w/ the 140% Available Unit Rule. Read-only
// preview — does not persist or stamp (submit/review do that); scope enforced
// via getById so a manager can't probe recerts outside their portfolio.
router.get(
  "/:id/income-check",
  authenticate,
  requirePermission("recertification:view"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const recert = await service.getById(req.params.id as string, req);
      if (!recert) {
        res.status(404).json({ error: "Recertification not found" });
        return;
      }
      const result = await compliance.check(req.params.id as string, {
        persist: false,
        stamp: false,
      });
      if (!result) {
        res.status(404).json({ error: "Recertification not found" });
        return;
      }
      res.json(result);
    } catch (err: any) {
      logger.error("Failed to run recert income check", { error: err.message });
      res.status(500).json({ error: "Failed to run recert income check" });
    }
  }
);

// Create recertification manually
const CreateSchema = z.object({
  applicationId: z.string().guid(),
});

router.post(
  "/",
  authenticate,
  requirePermission("recertification:manage"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }
    try {
      const result = await service.createForApplication(parsed.data.applicationId, req.user!.id, req.user!.role);
      res.status(201).json(result);
    } catch (err: any) {
      logger.error("Failed to create recertification", { error: err.message });
      res.status(400).json({ error: err.message });
    }
  }
);

// Submit recertification
const SubmitSchema = z.object({
  newIncome: z.number().positive().optional(),
});

router.post(
  "/:id/submit",
  authenticate,
  requirePermission("recertification:manage"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = SubmitSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }
    try {
      await service.submit(req.params.id as string, req.user!.id, req.user!.role, parsed.data.newIncome);
      res.json({ success: true });
    } catch (err: any) {
      logger.error("Failed to submit recertification", { error: err.message });
      res.status(400).json({ error: err.message });
    }
  }
);

// Review recertification (approve/deny)
const ReviewSchema = z.object({
  decision: z.enum(["pass", "fail"]),
  notes: z.string().min(1, "Review notes are required"),
  newIncome: z.number().positive().optional(),
  rentAdjustment: z.number().optional(),
});

router.post(
  "/:id/review",
  authenticate,
  requirePermission("recertification:review"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = ReviewSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }
    try {
      await service.review(
        req.params.id as string,
        req.user!.id,
        req.user!.role,
        parsed.data.decision,
        parsed.data.notes,
        parsed.data.newIncome,
        parsed.data.rentAdjustment
      );
      res.json({ success: true });
    } catch (err: any) {
      logger.error("Failed to review recertification", { error: err.message });
      res.status(400).json({ error: err.message });
    }
  }
);

// Resolve an open NAU (Next Available Unit Rule) obligation (QAP Phase 3.2):
// credit a comparable available unit rented to a qualifying household so the
// over-income unit's set-aside is preserved. Scope-checked via getById so a
// manager can't resolve recerts outside their portfolio. Validation failures
// (non-comparable / not-rented / no open obligation) map to 400.
const NauResolveSchema = z.object({
  resolvingUnitId: z.string().guid(),
  notes: z.string().min(1, "Notes are required"),
});

router.post(
  "/:id/nau-resolve",
  authenticate,
  requirePermission("recertification:review"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = NauResolveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }
    try {
      const recert = await service.getById(req.params.id as string, req);
      if (!recert) {
        res.status(404).json({ error: "Recertification not found" });
        return;
      }
      const context = await compliance.resolveNau(
        req.params.id as string,
        parsed.data.resolvingUnitId,
        req.user!.id,
        parsed.data.notes
      );
      const updated = await service.getById(req.params.id as string, req);
      res.json({ success: true, recertification: updated, context });
    } catch (err: any) {
      logger.error("Failed to resolve NAU obligation", { error: err.message });
      res.status(400).json({ error: err.message });
    }
  }
);

// Mark an open NAU (Next Available Unit Rule) obligation LOST (QAP Phase 3.2):
// the inverse of /nau-resolve. The next comparable available unit was rented
// to a non-qualifying household (consuming the slot), or the obligation
// otherwise lapsed — the over-income unit converts to market rent. Staff
// attest the reason; an optional triggeringUnitId names the consumed slot
// (must be comparable + rented). Scope-checked via getById. Validation
// failures (no open obligation / non-comparable / not-rented) map to 400.
const NauLostSchema = z.object({
  triggeringUnitId: z.string().uuid().optional(),
  reason: z.string().min(1, "A reason is required"),
});

router.post(
  "/:id/nau-lost",
  authenticate,
  requirePermission("recertification:review"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = NauLostSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }
    try {
      const recert = await service.getById(req.params.id as string, req);
      if (!recert) {
        res.status(404).json({ error: "Recertification not found" });
        return;
      }
      const context = await compliance.markNauLost(
        req.params.id as string,
        parsed.data.triggeringUnitId ?? null,
        req.user!.id,
        parsed.data.reason
      );
      const updated = await service.getById(req.params.id as string, req);
      res.json({ success: true, recertification: updated, context });
    } catch (err: any) {
      logger.error("Failed to mark NAU obligation lost", { error: err.message });
      res.status(400).json({ error: err.message });
    }
  }
);

// Manual trigger: process all reminders (system_admin)
router.post(
  "/process-reminders",
  authenticate,
  requirePermission("user:manage"), // system_admin only
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const stats = await service.processReminders();
      res.json(stats);
    } catch (err: any) {
      logger.error("Failed to process reminders", { error: err.message });
      res.status(500).json({ error: "Failed to process reminders" });
    }
  }
);

export default router;
