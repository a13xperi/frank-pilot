/**
 * Acquisitions API — QAP Demand-Evidence Engine (Phase 1).
 *
 * Internal, staff-only surface (asset_manager / system_admin) for the credit
 * acquisition side of the lifecycle. Phase 1 exposes the demand rollup and the
 * market-study-shaped demand packet. Phases 2 (project scoring) and 3
 * (compliance bridge / award) mount additional routes here.
 *
 *   GET /api/acquisitions/demand          — rollup, filterable
 *   GET /api/acquisitions/demand/packet   — market-study packet per submarket
 */
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { logger } from '../../utils/logger';
import { DemandService, type DemandFilters, type AmiTier } from './demand-service';
import { GEOGRAPHIC_ACCOUNTS, type GeographicAccount } from './qap-2026';

const router = Router();
const service = new DemandService();

const ACCOUNTS = Object.keys(GEOGRAPHIC_ACCOUNTS) as [GeographicAccount, ...GeographicAccount[]];

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

export default router;
