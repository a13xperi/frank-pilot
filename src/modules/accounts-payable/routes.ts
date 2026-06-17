import { Router, Response } from "express";
import { z } from "zod";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { requirePermission } from "../../middleware/rbac";
import { ApService } from "./service";
import { logger } from "../../utils/logger";

const router = Router();
const service = new ApService();

const actorOf = (req: AuthRequest) => ({ id: req.user!.id, role: req.user!.role });

/** Map a service error to a status: not-found → 404, everything else → 400. */
function fail(res: Response, err: unknown, log: string): void {
  const message = (err as Error).message;
  logger.error(log, { error: message });
  res.status(/not found/i.test(message) ? 404 : 400).json({ error: message });
}

// ─────────────────────────────────────────────────────────────
// Vendors
// ─────────────────────────────────────────────────────────────
const VendorSchema = z.object({
  name: z.string().min(1),
  address: z.string().optional(),
  phone: z.string().optional(),
  taxId: z.string().optional(),
});

router.post(
  "/vendors",
  authenticate,
  requirePermission("ap:manage"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = VendorSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }
    try {
      res.status(201).json(await service.registerVendor(parsed.data, actorOf(req)));
    } catch (err) {
      fail(res, err, "Failed to register vendor");
    }
  },
);

router.get(
  "/vendors",
  authenticate,
  requirePermission("ap:view"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      res.json(await service.listVendors(req.query.activeOnly === "true"));
    } catch (err) {
      logger.error("Failed to list vendors", { error: (err as Error).message });
      res.status(500).json({ error: "Failed to list vendors" });
    }
  },
);

// ─────────────────────────────────────────────────────────────
// Invoices
// ─────────────────────────────────────────────────────────────
const InvoiceSchema = z.object({
  vendorId: z.string().uuid(),
  propertyId: z.string().uuid(),
  unitId: z.string().uuid().optional(),
  amountCents: z.number().int().positive(),
  invoiceNumber: z.string().optional(),
  billingNumber: z.string().optional(),
  unitNumber: z.string().optional(),
  dueDate: z.string().optional(),
  receivedVia: z.enum(["email", "postal", "manager_forward"]),
});

router.post(
  "/invoices",
  authenticate,
  requirePermission("ap:cut"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = InvoiceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }
    try {
      res.status(201).json(await service.captureInvoice(parsed.data, actorOf(req)));
    } catch (err) {
      fail(res, err, "Failed to capture invoice");
    }
  },
);

router.get(
  "/invoices",
  authenticate,
  requirePermission("ap:view"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      res.json(
        await service.listInvoices({
          propertyId: req.query.propertyId as string | undefined,
          status: req.query.status as string | undefined,
          dueBefore: req.query.dueBefore as string | undefined,
        }),
      );
    } catch (err) {
      logger.error("Failed to list invoices", { error: (err as Error).message });
      res.status(500).json({ error: "Failed to list invoices" });
    }
  },
);

// ─────────────────────────────────────────────────────────────
// Check runs + cut
// ─────────────────────────────────────────────────────────────
const CheckRunSchema = z.object({
  propertyId: z.string().uuid(),
  bankAccountRef: z.string().min(1),
  weekOf: z.string(), // YYYY-MM-DD (Monday cutoff window)
});

router.post(
  "/check-runs",
  authenticate,
  requirePermission("ap:cut"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = CheckRunSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }
    try {
      res.status(201).json(await service.openCheckRun(parsed.data, actorOf(req)));
    } catch (err) {
      fail(res, err, "Failed to open check run");
    }
  },
);

const CutSchema = z.object({
  invoiceId: z.string().uuid(),
  checkNumber: z.string().optional(),
});

router.post(
  "/check-runs/:runId/checks",
  authenticate,
  requirePermission("ap:cut"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = CutSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }
    try {
      const check = await service.cutCheck(
        { checkRunId: req.params.runId as string, invoiceId: parsed.data.invoiceId, checkNumber: parsed.data.checkNumber },
        actorOf(req),
      );
      res.status(201).json(check);
    } catch (err) {
      fail(res, err, "Failed to cut check");
    }
  },
);

// ─────────────────────────────────────────────────────────────
// Approval chain + lifecycle
// ─────────────────────────────────────────────────────────────
const DecisionSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  notes: z.string().optional(),
});

router.post(
  "/checks/:id/review",
  authenticate,
  requirePermission("ap:review"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = DecisionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }
    try {
      res.json(await service.reviewCheck(req.params.id as string, parsed.data.decision, parsed.data.notes, actorOf(req)));
    } catch (err) {
      fail(res, err, "Failed to review check");
    }
  },
);

router.post(
  "/checks/:id/sign",
  authenticate,
  requirePermission("ap:sign"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = DecisionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }
    try {
      res.json(await service.signCheck(req.params.id as string, parsed.data.decision, parsed.data.notes, actorOf(req)));
    } catch (err) {
      fail(res, err, "Failed to sign check");
    }
  },
);

router.post(
  "/checks/:id/disburse",
  authenticate,
  requirePermission("ap:cut"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      res.json(await service.disburseCheck(req.params.id as string, actorOf(req)));
    } catch (err) {
      fail(res, err, "Failed to disburse check");
    }
  },
);

const VoidSchema = z.object({ reason: z.string().min(1, "Reason is required") });

router.post(
  "/checks/:id/void",
  authenticate,
  requirePermission("ap:correct"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = VoidSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }
    try {
      res.json(await service.voidCheck(req.params.id as string, parsed.data.reason, actorOf(req)));
    } catch (err) {
      fail(res, err, "Failed to void check");
    }
  },
);

router.post(
  "/checks/:id/reissue",
  authenticate,
  requirePermission("ap:correct"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      res.status(201).json(await service.reissueCheck(req.params.id as string, actorOf(req)));
    } catch (err) {
      fail(res, err, "Failed to reissue check");
    }
  },
);

router.get(
  "/checks/:id",
  authenticate,
  requirePermission("ap:view"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const check = await service.getCheck(req.params.id as string);
      if (!check) {
        res.status(404).json({ error: "Check not found" });
        return;
      }
      res.json(check);
    } catch (err) {
      logger.error("Failed to get check", { error: (err as Error).message });
      res.status(500).json({ error: "Failed to get check" });
    }
  },
);

export default router;
