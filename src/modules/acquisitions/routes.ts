/**
 * Acquisitions API — QAP Demand-Evidence Engine (Phase 1) + Project Scoring
 * (Phase 2).
 *
 * Internal, staff-only surface (asset_manager / system_admin) for the credit
 * acquisition side of the lifecycle. Reads gate on `acquisition:view`; writes
 * (project create/update/delete) gate on `acquisition:manage`. Phase 3
 * (compliance bridge / award) mounts additional routes here.
 *
 *   GET    /api/acquisitions/demand          — rollup, filterable
 *   GET    /api/acquisitions/demand/packet   — market-study packet per submarket
 *   GET    /api/acquisitions/projects        — list candidate projects
 *   POST   /api/acquisitions/projects        — create
 *   GET    /api/acquisitions/projects/:id    — get one
 *   PUT    /api/acquisitions/projects/:id    — update
 *   DELETE /api/acquisitions/projects/:id    — delete
 *   GET    /api/acquisitions/projects/:id/score — score vs QAP subset + demand
 */
import { Router, type Response } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { logger } from '../../utils/logger';
import { DemandService, type DemandFilters, type AmiTier } from './demand-service';
import { ProjectService, type ProjectInput } from './project-service';
import { AwardService, AwardInput, AwardStatus, AWARD_STATUSES, BridgeError } from './award-service';
import { AurQueueService } from './aur-queue-service';
import type { AmiDesignation } from './compliance-bridge';
import {
  GEOGRAPHIC_ACCOUNTS,
  SET_ASIDES,
  RENT_ELECTIONS,
  RESIDENT_SERVICES,
  type GeographicAccount,
} from './qap-2026';

const router = Router();
const service = new DemandService();
const projects = new ProjectService();
const awards = new AwardService();
const aurQueue = new AurQueueService();

const ACCOUNTS = Object.keys(GEOGRAPHIC_ACCOUNTS) as [GeographicAccount, ...GeographicAccount[]];
const SET_ASIDE_KEYS = Object.keys(SET_ASIDES) as [string, ...string[]];
const ELECTION_KEYS = Object.keys(RENT_ELECTIONS) as [string, ...string[]];
const SERVICE_KEYS = Object.keys(RESIDENT_SERVICES) as [string, ...string[]];

const DemandQuerySchema = z.object({
  // `account` is the QAP geographic account; `county` accepted as an alias
  // because the funnel surfaces speak in counties.
  account: z.enum(ACCOUNTS).optional(),
  county: z.enum(ACCOUNTS).optional(),
  bedrooms: z.coerce.number().int().min(0).max(6).optional(),
  tier: z.enum(['30', '50', '60', '80']).optional(),
});

const PacketQuerySchema = z.object({
  account: z.enum(ACCOUNTS).optional(),
  submarket: z.enum(ACCOUNTS).optional(),
});

/**
 * GET /api/acquisitions/demand
 * Demand + supply rollup by geographic account × bedroom × AMI tier.
 * Query: account|county, bedrooms, tier (all optional).
 */
router.get(
  '/demand',
  authenticate,
  requirePermission('acquisition:view'),
  async (req: AuthRequest, res) => {
    const parsed = DemandQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid query', details: parsed.error.flatten() });
      return;
    }
    const { account, county, bedrooms, tier } = parsed.data;
    const filters: DemandFilters = {
      account: account ?? county,
      bedrooms,
      tier: tier as AmiTier | undefined,
    };
    try {
      const rollup = await service.getDemand(filters);
      res.json(rollup);
    } catch (err) {
      logger.error('acquisitions: demand rollup failed', { err });
      res.status(500).json({ error: 'Failed to compute demand rollup' });
    }
  },
);

/**
 * GET /api/acquisitions/demand/packet
 * Market-study-shaped demand packet for one geographic account (submarket),
 * for attaching to a 9%/4% credit application. Defaults to Clark.
 */
router.get(
  '/demand/packet',
  authenticate,
  requirePermission('acquisition:view'),
  async (req: AuthRequest, res) => {
    const parsed = PacketQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid query', details: parsed.error.flatten() });
      return;
    }
    const account: GeographicAccount = parsed.data.account ?? parsed.data.submarket ?? 'CLARK';
    try {
      const packet = await service.getDemandPacket(account);
      res.json(packet);
    } catch (err) {
      logger.error('acquisitions: demand packet failed', { err });
      res.status(500).json({ error: 'Failed to build demand packet' });
    }
  },
);

// ── Phase 2: candidate projects ──────────────────────────────────────────────

const ProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    geographicAccount: z.enum(ACCOUNTS),
    city: z.string().trim().max(120).optional().nullable(),
    setAside: z.enum(SET_ASIDE_KEYS).optional().nullable(),
    electionKind: z.enum(ELECTION_KEYS),
    totalUnits: z.coerce.number().int().min(0).max(100000),
    units30Ami: z.coerce.number().int().min(0).max(100000),
    units50Ami: z.coerce.number().int().min(0).max(100000),
    units60Ami: z.coerce.number().int().min(0).max(100000),
    isQct: z.boolean().default(false),
    isDda: z.boolean().default(false),
    residentServices: z.array(z.enum(SERVICE_KEYS)).default([]),
    notes: z.string().trim().max(5000).optional().nullable(),
  })
  // Restricted units can't exceed the unit count — a unit-mix sanity check.
  .refine((p) => p.units30Ami + p.units50Ami + p.units60Ami <= p.totalUnits, {
    message: 'Restricted units (30+50+60% AMI) cannot exceed total units.',
    path: ['totalUnits'],
  });

/** GET /api/acquisitions/projects — list candidate projects. */
router.get(
  '/projects',
  authenticate,
  requirePermission('acquisition:view'),
  async (_req: AuthRequest, res) => {
    try {
      res.json({ projects: await projects.list() });
    } catch (err) {
      logger.error('acquisitions: list projects failed', { err });
      res.status(500).json({ error: 'Failed to list projects' });
    }
  },
);

/** POST /api/acquisitions/projects — create a candidate project. */
router.post(
  '/projects',
  authenticate,
  requirePermission('acquisition:manage'),
  async (req: AuthRequest, res) => {
    const parsed = ProjectSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid project', details: parsed.error.flatten() });
      return;
    }
    try {
      const created = await projects.create(parsed.data as ProjectInput, req.user?.id ?? null);
      res.status(201).json({ project: created });
    } catch (err) {
      logger.error('acquisitions: create project failed', { err });
      res.status(500).json({ error: 'Failed to create project' });
    }
  },
);

/** GET /api/acquisitions/projects/:id — fetch one. */
router.get(
  '/projects/:id',
  authenticate,
  requirePermission('acquisition:view'),
  async (req: AuthRequest, res) => {
    try {
      const project = await projects.get((req.params.id as string));
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }
      res.json({ project });
    } catch (err) {
      logger.error('acquisitions: get project failed', { err });
      res.status(500).json({ error: 'Failed to fetch project' });
    }
  },
);

/** PUT /api/acquisitions/projects/:id — update. */
router.put(
  '/projects/:id',
  authenticate,
  requirePermission('acquisition:manage'),
  async (req: AuthRequest, res) => {
    const parsed = ProjectSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid project', details: parsed.error.flatten() });
      return;
    }
    try {
      const updated = await projects.update((req.params.id as string), parsed.data as ProjectInput);
      if (!updated) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }
      res.json({ project: updated });
    } catch (err) {
      logger.error('acquisitions: update project failed', { err });
      res.status(500).json({ error: 'Failed to update project' });
    }
  },
);

/** DELETE /api/acquisitions/projects/:id. */
router.delete(
  '/projects/:id',
  authenticate,
  requirePermission('acquisition:manage'),
  async (req: AuthRequest, res) => {
    try {
      const removed = await projects.remove((req.params.id as string));
      if (!removed) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }
      res.status(204).end();
    } catch (err) {
      logger.error('acquisitions: delete project failed', { err });
      res.status(500).json({ error: 'Failed to delete project' });
    }
  },
);

/**
 * GET /api/acquisitions/projects/:id/score
 * Score the project against the focused QAP subset, joining current funnel
 * demand for its geographic account as the §6.1 market-study input.
 */
router.get(
  '/projects/:id/score',
  authenticate,
  requirePermission('acquisition:view'),
  async (req: AuthRequest, res) => {
    try {
      const scored = await projects.score((req.params.id as string));
      if (!scored) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }
      res.json(scored);
    } catch (err) {
      logger.error('acquisitions: score project failed', { err });
      res.status(500).json({ error: 'Failed to score project' });
    }
  },
);

// ── Phase 3: awards + the compliance bridge ──────────────────────────────────

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const AWARD_STATUS_KEYS = AWARD_STATUSES as [AwardStatus, ...AwardStatus[]];

const AwardCreateSchema = z.object({
  acqProjectId: z.string().guid(),
  propertyId: z.string().guid().optional().nullable(),
  status: z.enum(AWARD_STATUS_KEYS).optional(),
  reservationAmount: z.coerce.number().min(0).optional().nullable(),
  awardDate: DATE.optional().nullable(),
  placedInServiceDeadline: DATE.optional().nullable(),
  notes: z.string().trim().max(5000).optional().nullable(),
});

// Update: every field optional, but at least one present (a no-op PUT is a 400).
const AwardUpdateSchema = z
  .object({
    propertyId: z.string().guid().nullable(),
    status: z.enum(AWARD_STATUS_KEYS),
    reservationAmount: z.coerce.number().min(0).nullable(),
    awardDate: DATE.nullable(),
    placedInServiceDeadline: DATE.nullable(),
    notes: z.string().trim().max(5000).nullable(),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, { message: 'No fields to update.' });

const BindSchema = z.object({ propertyId: z.string().guid().nullable() });

const DesignationsSchema = z.object({
  assignments: z
    .array(
      z.object({
        unitId: z.string().guid(),
        designation: z.enum(['30', '50', '60', 'market']),
      }),
    )
    .min(1)
    .max(2000),
});

/** Map a BridgeError to its HTTP status; returns true if it handled `err`. */
function handleBridgeError(err: unknown, res: Response): boolean {
  if (err instanceof BridgeError) {
    const status = { NOT_FOUND: 404, NOT_BOUND: 409, VALIDATION: 400, CONFLICT: 409 }[err.code];
    res.status(status).json({ error: err.message, ...(err.detail ? { details: err.detail } : {}) });
    return true;
  }
  return false;
}

/** GET /api/acquisitions/awards — list all awards, newest first. */
router.get(
  '/awards',
  authenticate,
  requirePermission('acquisition:view'),
  async (_req: AuthRequest, res) => {
    try {
      res.json({ awards: await awards.list() });
    } catch (err) {
      logger.error('acquisitions: list awards failed', { err });
      res.status(500).json({ error: 'Failed to list awards' });
    }
  },
);

/** POST /api/acquisitions/awards — record a won reservation for a project. */
router.post(
  '/awards',
  authenticate,
  requirePermission('acquisition:manage'),
  async (req: AuthRequest, res) => {
    const parsed = AwardCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid award', details: parsed.error.flatten() });
      return;
    }
    try {
      const created = await awards.create(parsed.data as AwardInput, req.user?.id ?? null);
      res.status(201).json({ award: created });
    } catch (err) {
      if (handleBridgeError(err, res)) return;
      logger.error('acquisitions: create award failed', { err });
      res.status(500).json({ error: 'Failed to create award' });
    }
  },
);

/** GET /api/acquisitions/awards/:id. */
router.get(
  '/awards/:id',
  authenticate,
  requirePermission('acquisition:view'),
  async (req: AuthRequest, res) => {
    try {
      const award = await awards.get(req.params.id as string);
      if (!award) {
        res.status(404).json({ error: 'Award not found' });
        return;
      }
      res.json({ award });
    } catch (err) {
      logger.error('acquisitions: get award failed', { err });
      res.status(500).json({ error: 'Failed to fetch award' });
    }
  },
);

/** PUT /api/acquisitions/awards/:id — update status/dates/amount/notes/binding. */
router.put(
  '/awards/:id',
  authenticate,
  requirePermission('acquisition:manage'),
  async (req: AuthRequest, res) => {
    const parsed = AwardUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid award', details: parsed.error.flatten() });
      return;
    }
    try {
      const updated = await awards.update(req.params.id as string, parsed.data as Partial<AwardInput>);
      if (!updated) {
        res.status(404).json({ error: 'Award not found' });
        return;
      }
      res.json({ award: updated });
    } catch (err) {
      if (handleBridgeError(err, res)) return;
      logger.error('acquisitions: update award failed', { err });
      res.status(500).json({ error: 'Failed to update award' });
    }
  },
);

/** POST /api/acquisitions/awards/:id/bind — bind (or unbind) a managed property. */
router.post(
  '/awards/:id/bind',
  authenticate,
  requirePermission('acquisition:manage'),
  async (req: AuthRequest, res) => {
    const parsed = BindSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid binding', details: parsed.error.flatten() });
      return;
    }
    try {
      const updated = await awards.update(req.params.id as string, { propertyId: parsed.data.propertyId });
      if (!updated) {
        res.status(404).json({ error: 'Award not found' });
        return;
      }
      res.json({ award: updated });
    } catch (err) {
      if (handleBridgeError(err, res)) return;
      logger.error('acquisitions: bind award failed', { err });
      res.status(500).json({ error: 'Failed to bind property' });
    }
  },
);

/** DELETE /api/acquisitions/awards/:id. */
router.delete(
  '/awards/:id',
  authenticate,
  requirePermission('acquisition:manage'),
  async (req: AuthRequest, res) => {
    try {
      const removed = await awards.remove(req.params.id as string);
      if (!removed) {
        res.status(404).json({ error: 'Award not found' });
        return;
      }
      res.status(204).end();
    } catch (err) {
      logger.error('acquisitions: delete award failed', { err });
      res.status(500).json({ error: 'Failed to delete award' });
    }
  },
);

/**
 * GET /api/acquisitions/awards/:id/plan
 * The designation plan: committed unit mix vs. the bound property's current
 * AMI designations. 409 if the award isn't bound to a property yet.
 */
router.get(
  '/awards/:id/plan',
  authenticate,
  requirePermission('acquisition:view'),
  async (req: AuthRequest, res) => {
    try {
      const plan = await awards.designationPlan(req.params.id as string);
      if (!plan) {
        res.status(404).json({ error: 'Award not found' });
        return;
      }
      res.json({ plan });
    } catch (err) {
      if (handleBridgeError(err, res)) return;
      logger.error('acquisitions: designation plan failed', { err });
      res.status(500).json({ error: 'Failed to build designation plan' });
    }
  },
);

/**
 * GET /api/acquisitions/awards/:id/units
 * The bound property's units with their current AMI designation — the grid the
 * apply-designations form edits. 409 if the award isn't bound yet.
 */
router.get(
  '/awards/:id/units',
  authenticate,
  requirePermission('acquisition:view'),
  async (req: AuthRequest, res) => {
    try {
      const units = await awards.listBoundUnits(req.params.id as string);
      res.json({ units });
    } catch (err) {
      if (handleBridgeError(err, res)) return;
      logger.error('acquisitions: list bound units failed', { err });
      res.status(500).json({ error: 'Failed to list units' });
    }
  },
);

/**
 * POST /api/acquisitions/awards/:id/designations
 * Apply { unitId → designation } assignments to the bound property's units,
 * atomically, and stamp the compliance tape. Returns the refreshed plan.
 */
router.post(
  '/awards/:id/designations',
  authenticate,
  requirePermission('acquisition:manage'),
  async (req: AuthRequest, res) => {
    const parsed = DesignationsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid assignments', details: parsed.error.flatten() });
      return;
    }
    try {
      const result = await awards.applyDesignations(
        req.params.id as string,
        parsed.data.assignments as Array<{ unitId: string; designation: AmiDesignation }>,
        req.user?.id ?? null,
      );
      if (!result) {
        res.status(404).json({ error: 'Award not found' });
        return;
      }
      res.json(result);
    } catch (err) {
      if (handleBridgeError(err, res)) return;
      logger.error('acquisitions: apply designations failed', { err });
      res.status(500).json({ error: 'Failed to apply designations' });
    }
  },
);

/**
 * GET /api/acquisitions/awards/:id/compliance
 * Compliance rollup: the award plus its designation plan (designated vs.
 * committed restricted units, and whether the LURA commitment is met).
 */
router.get(
  '/awards/:id/compliance',
  authenticate,
  requirePermission('acquisition:view'),
  async (req: AuthRequest, res) => {
    try {
      const rollup = await awards.compliance(req.params.id as string);
      if (!rollup) {
        res.status(404).json({ error: 'Award not found' });
        return;
      }
      res.json(rollup);
    } catch (err) {
      if (handleBridgeError(err, res)) return;
      logger.error('acquisitions: compliance rollup failed', { err });
      res.status(500).json({ error: 'Failed to build compliance rollup' });
    }
  },
);

// ── Lane 2: over-income / AUR queue ─────────────────────────────────────────

const AurQueueQuerySchema = z.object({
  propertyId: z.string().guid().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

/**
 * GET /api/acquisitions/aur-queue
 * Returns recertifications where income_ceiling_verdict is over_income or
 * over_income_aur, scoped to the caller's portfolio. Staff with
 * system_admin / asset_manager / regional_manager see all properties;
 * scoped roles see only their assigned property_ids.
 *
 * Query: propertyId (UUID, optional), limit (1-200, default 50), offset (default 0).
 * Response: { queue: [...], total: N }
 */
router.get(
  '/aur-queue',
  authenticate,
  requirePermission('acquisition:view'),
  async (req: AuthRequest, res) => {
    const parsed = AurQueueQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid query', details: parsed.error.flatten() });
      return;
    }
    try {
      const result = await aurQueue.list(parsed.data, req);
      res.json(result);
    } catch (err) {
      logger.error('acquisitions: aur-queue failed', { err });
      res.status(500).json({ error: 'Failed to fetch AUR queue' });
    }
  },
);

export default router;
