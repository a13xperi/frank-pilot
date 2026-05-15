import { Router, Response } from "express";
import { z } from "zod";
import { authenticate, AuthRequest } from "../../middleware/auth";
import {
  requireTenantRole,
  scopeToOwnApplications,
  ScopedAuthRequest,
  assertApplicationOwnership,
} from "../../middleware/scope";
import { query } from "../../config/database";
import { LedgerService } from "../ledger/service";
import { MaintenanceService } from "../maintenance/service";
import { MessagesService, SenderRole } from "../messages/service";
import { logger } from "../../utils/logger";
import { param } from "../../utils/params";

const router: Router = Router();
const ledger = new LedgerService();
const maintenance = new MaintenanceService();
const messages = new MessagesService();

// All tenant routes require auth + applicant/tenant role + scope
router.use(authenticate, requireTenantRole, scopeToOwnApplications);

// ---------------------------------------------------------------
// GET /api/tenant/me — current user
// ---------------------------------------------------------------
router.get("/me", async (req: AuthRequest, res: Response) => {
  res.json({ user: req.user });
});

// ---------------------------------------------------------------
// GET /api/tenant/dashboard — aggregate snapshot
// ---------------------------------------------------------------
router.get("/dashboard", async (req: ScopedAuthRequest, res: Response) => {
  try {
    const ids = req.scopedApplicationIds || [];

    if (ids.length === 0) {
      res.json({
        user: req.user,
        applications: [],
        activeApplication: null,
        balance: null,
        nextDue: null,
        openWorkOrders: 0,
        recentLedger: [],
        lease: null,
        recertification: null,
        renewal: null,
      });
      return;
    }

    const appsRes = await query(
      `SELECT a.id, a.status, a.first_name, a.last_name, a.email, a.unit_number,
              a.requested_rent_amount, a.requested_move_in_date,
              a.onesite_lease_id, a.loft_tenant_id, a.auto_pay_enrolled,
              a.overall_screening_result, a.submitted_at, a.created_at,
              a.claimed_unit_id, a.claim_expires_at,
              p.id AS property_id, p.name AS property_name, p.address_line1 AS property_address,
              u.id AS cu_id, u.unit_number AS cu_unit_number, u.bedrooms AS cu_bedrooms,
              u.bathrooms AS cu_bathrooms, u.sqft AS cu_sqft, u.monthly_rent AS cu_monthly_rent,
              u.photo_url AS cu_photo_url, u.property_id AS cu_property_id,
              cup.name AS cu_property_name, cup.city AS cu_property_city, cup.state AS cu_property_state
       FROM applications a
       JOIN properties p ON a.property_id = p.id
       LEFT JOIN units u ON a.claimed_unit_id = u.id
         AND a.claim_expires_at IS NOT NULL
         AND a.claim_expires_at > NOW()
       LEFT JOIN properties cup ON u.property_id = cup.id
       WHERE a.id = ANY($1::uuid[])
       ORDER BY a.created_at DESC`,
      [ids]
    );

    const applications = appsRes.rows.map((r) => {
      const claimedUnit = r.cu_id
        ? {
            id: r.cu_id,
            property_id: r.cu_property_id,
            unit_number: r.cu_unit_number,
            bedrooms: r.cu_bedrooms,
            bathrooms: r.cu_bathrooms,
            sqft: r.cu_sqft,
            monthly_rent: r.cu_monthly_rent,
            photo_url: r.cu_photo_url,
            property_name: r.cu_property_name,
            property_city: r.cu_property_city,
            property_state: r.cu_property_state,
          }
        : null;
      const {
        cu_id: _cu_id,
        cu_unit_number: _cu_un,
        cu_bedrooms: _cu_b,
        cu_bathrooms: _cu_ba,
        cu_sqft: _cu_s,
        cu_monthly_rent: _cu_m,
        cu_photo_url: _cu_p,
        cu_property_id: _cu_pi,
        cu_property_name: _cu_pn,
        cu_property_city: _cu_pc,
        cu_property_state: _cu_ps,
        ...app
      } = r;
      return { ...app, claimed_unit: claimedUnit };
    });

    // Pick "active" application — onboarded > most recent
    const active =
      applications.find((a) => a.status === "onboarded") ||
      applications.find((a) => a.status === "lease_generated") ||
      applications[0] ||
      null;

    let balance = null;
    let recentLedger: unknown[] = [];
    let openWorkOrders = 0;
    let lease = null;
    let recertification = null;
    let renewal = null;

    if (active) {
      const bal = await ledger.getBalance(active.id);
      balance = bal;

      const led = await ledger.getLedger(active.id, { limit: 10 });
      recentLedger = led.entries;

      const wo = await query(
        `SELECT COUNT(*)::int AS n FROM work_orders
         WHERE application_id = $1 AND status NOT IN ('completed','cancelled')`,
        [active.id]
      );
      openWorkOrders = wo.rows[0].n;

      lease = {
        status: active.status,
        onesiteLeaseId: active.onesite_lease_id,
        loftTenantId: active.loft_tenant_id,
        autoPayEnrolled: active.auto_pay_enrolled,
        unitNumber: active.unit_number,
        propertyName: active.property_name,
        propertyAddress: active.property_address,
      };

      // Phase 3 stubs: best-effort lookups, ok if tables empty.
      try {
        const recert = await query(
          `SELECT id, type, status, anniversary_date, cutoff_date,
                  submitted_at, reviewed_at
           FROM recertifications
           WHERE application_id = $1
           ORDER BY anniversary_date DESC LIMIT 1`,
          [active.id]
        );
        recertification = recert.rows[0] || null;
      } catch {
        recertification = null;
      }

      try {
        const ren = await query(
          `SELECT id, status, current_rent, proposed_rent, proposed_term_months,
                  offered_at, response_at, response_deadline, tenant_response
           FROM lease_renewals
           WHERE application_id = $1
           ORDER BY created_at DESC LIMIT 1`,
          [active.id]
        );
        renewal = ren.rows[0] || null;
      } catch {
        renewal = null;
      }
    }

    res.json({
      user: req.user,
      applications,
      activeApplication: active,
      balance,
      nextDue: balance?.nextDueDate || null,
      openWorkOrders,
      recentLedger,
      lease,
      recertification,
      renewal,
    });
  } catch (err) {
    logger.error("tenant dashboard failed", { error: (err as Error).message });
    res.status(500).json({ error: "Failed to load dashboard" });
  }
});

// ---------------------------------------------------------------
// GET /api/tenant/applications/:applicationId/ledger
// ---------------------------------------------------------------
router.get(
  "/applications/:applicationId/ledger",
  async (req: AuthRequest, res: Response) => {
    try {
      const applicationId = param(req.params.applicationId);
      if (!(await assertApplicationOwnership(req, res, applicationId))) return;

      const [entries, balance] = await Promise.all([
        ledger.getLedger(applicationId, {
          limit: req.query.limit ? parseInt(req.query.limit as string) : 100,
          offset: req.query.offset ? parseInt(req.query.offset as string) : 0,
        }),
        ledger.getBalance(applicationId),
      ]);

      res.json({ ...entries, balance });
    } catch (err) {
      logger.error("tenant ledger failed", { error: (err as Error).message });
      res.status(500).json({ error: "Failed to load ledger" });
    }
  }
);

// ---------------------------------------------------------------
// POST /api/tenant/applications/:applicationId/pay — record a payment
//   Demo-safe: posts a ledger payment entry directly. In production this
//   would be wired to a Stripe paymentIntent and finalized via webhook.
// ---------------------------------------------------------------
const paySchema = z.object({
  amount: z.number().positive().max(100000),
  reference: z.string().optional(),
  notes: z.string().max(500).optional(),
});

router.post(
  "/applications/:applicationId/pay",
  async (req: AuthRequest, res: Response) => {
    try {
      const applicationId = param(req.params.applicationId);
      if (!(await assertApplicationOwnership(req, res, applicationId))) return;

      const parsed = paySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Validation failed", details: parsed.error.errors });
        return;
      }

      const entry = await ledger.recordPayment(
        applicationId,
        parsed.data.amount,
        parsed.data.reference || `tenant-portal-${Date.now()}`,
        req.user!.id,
        req.user!.role,
        parsed.data.notes
      );

      res.status(201).json({ ok: true, entry });
    } catch (err) {
      logger.error("tenant pay failed", { error: (err as Error).message });
      res.status(500).json({ error: "Payment failed" });
    }
  }
);

// ---------------------------------------------------------------
// GET /api/tenant/maintenance — list my work orders
// ---------------------------------------------------------------
router.get(
  "/maintenance",
  async (req: ScopedAuthRequest, res: Response) => {
    try {
      const ids = req.scopedApplicationIds || [];
      if (ids.length === 0) {
        res.json({ workOrders: [] });
        return;
      }
      const result = await query(
        `SELECT w.id, w.title, w.description, w.priority, w.category, w.status,
                w.is_emergency, w.unit_number, w.application_id, w.created_at,
                w.assigned_at, w.completed_at,
                p.name AS property_name
         FROM work_orders w
         JOIN properties p ON w.property_id = p.id
         WHERE w.application_id = ANY($1::uuid[])
         ORDER BY w.created_at DESC`,
        [ids]
      );
      res.json({ workOrders: result.rows });
    } catch (err) {
      logger.error("tenant maintenance list failed", { error: (err as Error).message });
      res.status(500).json({ error: "Failed to list work orders" });
    }
  }
);

// ---------------------------------------------------------------
// POST /api/tenant/maintenance — submit a work order
// ---------------------------------------------------------------
const submitWorkOrderSchema = z.object({
  applicationId: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  priority: z.enum(["routine", "urgent", "emergency"]).default("routine"),
  category: z.string().max(100).optional(),
});

router.post("/maintenance", async (req: AuthRequest, res: Response) => {
  try {
    const parsed = submitWorkOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.errors });
      return;
    }
    if (!(await assertApplicationOwnership(req, res, parsed.data.applicationId))) return;

    // Look up property_id + unit_number from the application
    const appRow = await query(
      "SELECT property_id, unit_number FROM applications WHERE id = $1",
      [parsed.data.applicationId]
    );
    if (appRow.rows.length === 0) {
      res.status(404).json({ error: "Application not found" });
      return;
    }

    const result = await maintenance.createWorkOrder(
      appRow.rows[0].property_id,
      parsed.data.title,
      parsed.data.description,
      parsed.data.priority,
      req.user!.id,
      req.user!.role,
      appRow.rows[0].unit_number || undefined,
      parsed.data.applicationId,
      parsed.data.category
    );

    res.status(201).json(result);
  } catch (err) {
    logger.error("tenant maintenance submit failed", { error: (err as Error).message });
    res.status(500).json({ error: "Failed to submit work order" });
  }
});

// ---------------------------------------------------------------
// GET /api/tenant/applications/:applicationId — application detail
// ---------------------------------------------------------------
router.get(
  "/applications/:applicationId",
  async (req: AuthRequest, res: Response) => {
    try {
      const applicationId = param(req.params.applicationId);
      if (!(await assertApplicationOwnership(req, res, applicationId))) return;

      const result = await query(
        `SELECT a.id, a.status, a.first_name, a.last_name, a.email, a.phone,
                a.unit_number, a.requested_rent_amount, a.requested_move_in_date,
                a.overall_screening_result, a.onesite_lease_id, a.loft_tenant_id,
                a.auto_pay_enrolled, a.submitted_at, a.created_at,
                p.id AS property_id, p.name AS property_name, p.address_line1 AS property_address
         FROM applications a
         JOIN properties p ON a.property_id = p.id
         WHERE a.id = $1`,
        [applicationId]
      );
      if (result.rows.length === 0) {
        res.status(404).json({ error: "Application not found" });
        return;
      }
      res.json(result.rows[0]);
    } catch (err) {
      logger.error("tenant application detail failed", { error: (err as Error).message });
      res.status(500).json({ error: "Failed to load application" });
    }
  }
);

// ---------------------------------------------------------------
// GET /api/tenant/applications/:applicationId/messages — list thread
// ---------------------------------------------------------------
router.get(
  "/applications/:applicationId/messages",
  async (req: AuthRequest, res: Response) => {
    try {
      const applicationId = param(req.params.applicationId);
      if (!(await assertApplicationOwnership(req, res, applicationId))) return;

      const list = await messages.listForApplication(applicationId);
      res.json({ messages: list });
    } catch (err) {
      logger.error("tenant messages list failed", { error: (err as Error).message });
      res.status(500).json({ error: "Failed to load messages" });
    }
  }
);

// ---------------------------------------------------------------
// POST /api/tenant/applications/:applicationId/messages — reply to staff
// ---------------------------------------------------------------
const messageBodySchema = z.object({
  body: z.string().trim().min(1).max(4000),
});

router.post(
  "/applications/:applicationId/messages",
  async (req: AuthRequest, res: Response) => {
    try {
      const applicationId = param(req.params.applicationId);
      if (!(await assertApplicationOwnership(req, res, applicationId))) return;

      const parsed = messageBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: "Validation failed", details: parsed.error.errors });
        return;
      }

      // Derive sender_role from the authenticated user's portal role
      // (applicant or tenant — staff cannot hit this path via requireTenantRole).
      const senderRole = (req.user!.role === "tenant" ? "tenant" : "applicant") as SenderRole;

      const message = await messages.create({
        applicationId,
        senderUserId: req.user!.id,
        senderRole,
        body: parsed.data.body,
      });
      res.status(201).json({ message });
    } catch (err) {
      logger.error("tenant message create failed", { error: (err as Error).message });
      res.status(500).json({ error: "Failed to send message" });
    }
  }
);

// ---------------------------------------------------------------
// POST /api/tenant/applications/:applicationId/messages/:msgId/read
// — applicant/tenant marks staff message as read
// ---------------------------------------------------------------
router.post(
  "/applications/:applicationId/messages/:msgId/read",
  async (req: AuthRequest, res: Response) => {
    try {
      const applicationId = param(req.params.applicationId);
      const messageId = param(req.params.msgId);
      if (!(await assertApplicationOwnership(req, res, applicationId))) return;

      const readerRole = (req.user!.role === "tenant" ? "tenant" : "applicant") as SenderRole;
      const ok = await messages.markRead({
        messageId,
        readerUserId: req.user!.id,
        readerRole,
      });
      res.json({ updated: ok });
    } catch (err) {
      logger.error("tenant message mark-read failed", { error: (err as Error).message });
      res.status(500).json({ error: "Failed to mark message read" });
    }
  }
);

export default router;
