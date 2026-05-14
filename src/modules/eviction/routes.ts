import { Router, Response } from "express";
import { z } from "zod";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { requirePermission } from "../../middleware/rbac";
import { EvictionService, EVICTION_CASE_STATUSES } from "./service";
import { logger } from "../../utils/logger";

const router = Router();
const service = new EvictionService();

// ── Violations ──────────────────────────────────────────────

router.get("/violations", authenticate, requirePermission("eviction:view"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const result = await service.getViolations({
        status: req.query.status as string | undefined,
        violationType: req.query.violationType as string | undefined,
        propertyId: req.query.propertyId as string | undefined,
        applicationId: req.query.applicationId as string | undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
        offset: req.query.offset ? parseInt(req.query.offset as string) : undefined,
      }, req);
      res.json(result);
    } catch (err: any) {
      logger.error("Failed to list violations", { error: err.message });
      res.status(500).json({ error: "Failed to list violations" });
    }
  }
);

router.get("/violations/:id", authenticate, requirePermission("eviction:view"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const violation = await service.getViolationById(req.params.id as string, req);
      if (!violation) { res.status(404).json({ error: "Violation not found" }); return; }
      res.json(violation);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

const ReportViolationSchema = z.object({
  applicationId: z.string().uuid(),
  violationType: z.string().min(1),
  description: z.string().min(1),
  occurredAt: z.string(),
  evidenceNotes: z.string().optional(),
});

router.post("/violations", authenticate, requirePermission("eviction:manage"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = ReportViolationSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() }); return; }
    try {
      const result = await service.reportViolation(
        parsed.data.applicationId, parsed.data.violationType, parsed.data.description,
        parsed.data.occurredAt, req.user!.id, req.user!.role, parsed.data.evidenceNotes
      );
      res.status(201).json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

router.post("/violations/:id/warning", authenticate, requirePermission("eviction:manage"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      await service.issueWarning(req.params.id as string, req.user!.id, req.user!.role);
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

const GenerateNoticeSchema = z.object({
  noticeType: z.string().min(1),
});

router.post("/violations/:id/notice", authenticate, requirePermission("eviction:manage"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = GenerateNoticeSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() }); return; }
    try {
      const result = await service.generateNotice(
        req.params.id as string, parsed.data.noticeType, req.user!.id, req.user!.role
      );
      res.status(201).json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

const ResolveSchema = z.object({ notes: z.string().min(1) });

router.post("/violations/:id/resolve", authenticate, requirePermission("eviction:manage"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = ResolveSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Validation failed" }); return; }
    try {
      await service.resolveViolation(req.params.id as string, parsed.data.notes, req.user!.id, req.user!.role);
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

router.post("/violations/:id/dismiss", authenticate, requirePermission("eviction:manage"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = ResolveSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Validation failed" }); return; }
    try {
      await service.dismissViolation(req.params.id as string, parsed.data.notes, req.user!.id, req.user!.role);
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

// ── Notices ─────────────────────────────────────────────────

router.get("/notices", authenticate, requirePermission("eviction:view"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const notices = await service.getNotices({
        applicationId: req.query.applicationId as string | undefined,
        status: req.query.status as string | undefined,
      }, req);
      res.json({ notices });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

router.get("/notices/:id", authenticate, requirePermission("eviction:view"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const notice = await service.getNoticeById(req.params.id as string, req);
      if (!notice) { res.status(404).json({ error: "Notice not found" }); return; }
      res.json(notice);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

router.post("/notices/:id/serve", authenticate, requirePermission("eviction:manage"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      await service.serveNotice(req.params.id as string, req.user!.id, req.user!.role);
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

// ── Cases ───────────────────────────────────────────────────

router.get("/cases", authenticate, requirePermission("eviction:view"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const cases = await service.getCases({
        status: req.query.status as string | undefined,
        applicationId: req.query.applicationId as string | undefined,
      }, req);
      res.json({ cases });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

const FileCaseSchema = z.object({
  noticeId: z.string().uuid(),
  caseNumber: z.string().min(1),
  jurisdiction: z.string().min(1),
});

router.post("/cases", authenticate, requirePermission("eviction:manage"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = FileCaseSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() }); return; }
    try {
      const result = await service.fileCase(
        parsed.data.noticeId, parsed.data.caseNumber, parsed.data.jurisdiction,
        req.user!.id, req.user!.role
      );
      res.status(201).json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

const UpdateCaseSchema = z.object({
  status: z.enum(EVICTION_CASE_STATUSES),
  hearingDate: z.string().optional(),
  judgmentDate: z.string().optional(),
  judgmentAmount: z.number().optional(),
  notes: z.string().optional(),
});

router.patch("/cases/:id", authenticate, requirePermission("eviction:manage"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = UpdateCaseSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() }); return; }
    try {
      await service.updateCaseStatus(
        req.params.id as string, parsed.data.status,
        { hearingDate: parsed.data.hearingDate, judgmentDate: parsed.data.judgmentDate, judgmentAmount: parsed.data.judgmentAmount, notes: parsed.data.notes },
        req.user!.id, req.user!.role
      );
      res.json({ success: true });
    } catch (err: any) {
      // Map state-machine + not-found errors to 400
      res.status(400).json({ error: err.message });
    }
  }
);

export default router;
