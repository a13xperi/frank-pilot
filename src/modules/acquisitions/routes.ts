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
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { logger } from '../../utils/logger';
import { DemandService, type DemandFilters, type AmiTier } from './demand-service';
import { ProjectService, type ProjectInput } from './project-service';
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

export default router;
