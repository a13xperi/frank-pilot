/**
 * Demand-Evidence Engine — turns funnel data into QAP-ready demand evidence.
 *
 * The thesis: the funnel's AMI-qualified demand is the asset that wins credits.
 * The Nevada 2026 QAP scores Market Study / demand (§6.1, Appendix A), low-rent
 * targeting (§7.4.1) and low-income targeting (§7.4.2). This service rolls up
 * the three live demand signals the funnel already captures —
 *
 *   • qualified applicants  (applications.qualifying_ami_tier, set at /intent)
 *   • waitlist depth        (waitlist_entries, position-aware)
 *   • unit supply           (units, available vs. total)
 *
 * — keyed by QAP geographic account (Clark/Washoe/Other) × bedroom × AMI tier,
 * and emits a market-study-shaped "demand packet" per submarket for attaching
 * to a 9%/4% credit application.
 *
 * Geographic account is resolved in JS (see geography.ts) so the funnel and the
 * acquisitions layer share ONE city→account mapping; SQL groups at the property
 * grain and this service folds property → account.
 */
import { query } from '../../config/database';
import { cityToGeographicAccount } from './geography';
import {
  type GeographicAccount,
  GEOGRAPHIC_ACCOUNTS,
  MARKET_STUDY,
  LOCATION_SCORING,
} from './qap-2026';

/** LIHTC AMI tiers, mirroring the funnel's `AmiTier` (limits-2026.generated). */
export type AmiTier = '30' | '50' | '60' | '80';
const TIER_ORDER: ReadonlyArray<AmiTier> = ['30', '50', '60', '80'];

export interface DemandFilters {
  account?: GeographicAccount;
  bedrooms?: number;
  tier?: AmiTier;
}

/** One demand cell: qualified applicants in a submarket × bedroom × tier. */
export interface DemandCell {
  account: GeographicAccount;
  bedrooms: number;
  tier: AmiTier;
  qualifiedApplicants: number;
}

/** Supply + waitlist depth in a submarket × bedroom. */
export interface SupplyCell {
  account: GeographicAccount;
  bedrooms: number;
  availableUnits: number;
  totalUnits: number;
  waitlistDepth: number;
}

export interface DemandRollup {
  filters: DemandFilters;
  demand: DemandCell[];
  supply: SupplyCell[];
  totals: {
    qualifiedApplicants: number;
    waitlistDepth: number;
    availableUnits: number;
    totalUnits: number;
  };
}

// ── Raw row shapes from the grouped SQL ──────────────────────────────────────
interface ApplicantRow {
  city: string | null;
  bedrooms: number | null;
  tier: string | null;
  applicants: string; // pg COUNT → string
  is_qct: boolean;
  is_dda: boolean;
}
interface WaitlistRow {
  city: string | null;
  bedrooms: number | null;
  depth: string;
}
interface UnitRow {
  city: string | null;
  bedrooms: number;
  available: string;
  total: string;
}

function isAmiTier(v: string | null): v is AmiTier {
  return v === '30' || v === '50' || v === '60' || v === '80';
}

export class DemandService {
  /**
   * Demand + supply rollup keyed by geographic account × bedroom × tier.
   * Filters narrow the result post-fold (the SQL always aggregates the full
   * funnel; the dataset is funnel-scale so this is cheap and keeps the
   * city→account mapping in one place).
   */
  async getDemand(filters: DemandFilters = {}): Promise<DemandRollup> {
    const [applicantRows, waitlistRows, unitRows] = await Promise.all([
      query(
        `SELECT p.city AS city,
                a.intent_bedrooms AS bedrooms,
                a.qualifying_ami_tier AS tier,
                COUNT(*)::int AS applicants,
                p.is_qct AS is_qct,
                p.is_dda AS is_dda
           FROM applications a
           JOIN properties p ON p.id = a.property_id
          WHERE a.qualifying_ami_tier IS NOT NULL
            AND a.intent_bedrooms IS NOT NULL
          GROUP BY p.city, a.intent_bedrooms, a.qualifying_ami_tier, p.is_qct, p.is_dda`,
      ),
      query(
        `SELECT p.city AS city,
                w.bedroom_count AS bedrooms,
                COUNT(*)::int AS depth
           FROM waitlist_entries w
           JOIN properties p ON p.id = w.property_id
          GROUP BY p.city, w.bedroom_count`,
      ),
      query(
        `SELECT p.city AS city,
                u.bedrooms AS bedrooms,
                COUNT(*) FILTER (WHERE u.status = 'available')::int AS available,
                COUNT(*)::int AS total
           FROM units u
           JOIN properties p ON p.id = u.property_id
          GROUP BY p.city, u.bedrooms`,
      ),
    ]);

    // Fold property-grain rows → geographic account.
    const demandMap = new Map<string, DemandCell>();
    for (const r of applicantRows.rows as ApplicantRow[]) {
      if (!isAmiTier(r.tier) || r.bedrooms == null) continue;
      const account = cityToGeographicAccount(r.city);
      const key = `${account}|${r.bedrooms}|${r.tier}`;
      const cell = demandMap.get(key) ?? {
        account,
        bedrooms: r.bedrooms,
        tier: r.tier,
        qualifiedApplicants: 0,
      };
      cell.qualifiedApplicants += Number(r.applicants);
      demandMap.set(key, cell);
    }

    const supplyMap = new Map<string, SupplyCell>();
    const supplyKey = (a: GeographicAccount, b: number) => `${a}|${b}`;
    const ensureSupply = (account: GeographicAccount, bedrooms: number): SupplyCell => {
      const key = supplyKey(account, bedrooms);
      let cell = supplyMap.get(key);
      if (!cell) {
        cell = { account, bedrooms, availableUnits: 0, totalUnits: 0, waitlistDepth: 0 };
        supplyMap.set(key, cell);
      }
      return cell;
    };
    for (const r of unitRows.rows as UnitRow[]) {
      const account = cityToGeographicAccount(r.city);
      const cell = ensureSupply(account, r.bedrooms);
      cell.availableUnits += Number(r.available);
      cell.totalUnits += Number(r.total);
    }
    for (const r of waitlistRows.rows as WaitlistRow[]) {
      if (r.bedrooms == null) continue;
      const account = cityToGeographicAccount(r.city);
      ensureSupply(account, r.bedrooms).waitlistDepth += Number(r.depth);
    }

    let demand = [...demandMap.values()];
    let supply = [...supplyMap.values()];

    if (filters.account) {
      demand = demand.filter((c) => c.account === filters.account);
      supply = supply.filter((c) => c.account === filters.account);
    }
    if (filters.bedrooms != null) {
      demand = demand.filter((c) => c.bedrooms === filters.bedrooms);
      supply = supply.filter((c) => c.bedrooms === filters.bedrooms);
    }
    if (filters.tier) {
      demand = demand.filter((c) => c.tier === filters.tier);
    }

    demand.sort(
      (a, b) =>
        a.account.localeCompare(b.account) ||
        a.bedrooms - b.bedrooms ||
        TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier),
    );
    supply.sort((a, b) => a.account.localeCompare(b.account) || a.bedrooms - b.bedrooms);

    const totals = {
      qualifiedApplicants: demand.reduce((s, c) => s + c.qualifiedApplicants, 0),
      waitlistDepth: supply.reduce((s, c) => s + c.waitlistDepth, 0),
      availableUnits: supply.reduce((s, c) => s + c.availableUnits, 0),
      totalUnits: supply.reduce((s, c) => s + c.totalUnits, 0),
    };

    return { filters, demand, supply, totals };
  }

  /**
   * Market-study-shaped demand packet for one geographic account, mapped to the
   * QAP criteria a credit application is scored against (§6.1 / Appendix A
   * market study; §7.4 targeting). Returns the demand depth, the targeting mix
   * (share of qualified demand by AMI tier — the evidence that deep-targeting
   * commitments are absorbable), an estimated capture rate vs. available
   * supply, and QCT/DDA basis-boost coverage.
   */
  async getDemandPacket(account: GeographicAccount): Promise<DemandPacket> {
    const rollup = await this.getDemand({ account });

    const byTier: Record<AmiTier, number> = { '30': 0, '50': 0, '60': 0, '80': 0 };
    for (const c of rollup.demand) byTier[c.tier] += c.qualifiedApplicants;
    const totalDemand = rollup.totals.qualifiedApplicants;

    const targetingMix = TIER_ORDER.map((tier) => ({
      tier,
      qualifiedApplicants: byTier[tier],
      sharePct: totalDemand > 0 ? round1((byTier[tier] / totalDemand) * 100) : 0,
    }));

    // Capture rate: share of qualified demand a build of the available supply
    // would absorb. Low capture = deep, durable demand (QAP §6.1 favors it).
    const captureRatePct =
      totalDemand > 0
        ? round1((rollup.totals.availableUnits / totalDemand) * 100)
        : null;

    // QCT/DDA coverage drives the §11 basis boost — surfaced from the property
    // flags via a direct count (the rollup folds these away).
    const qctCoverage = await this.getQctCoverage(account);

    return {
      account,
      accountLabel: GEOGRAPHIC_ACCOUNTS[account].label,
      generatedAt: new Date().toISOString(),
      demand: {
        qualifiedApplicants: totalDemand,
        waitlistDepth: rollup.totals.waitlistDepth,
        deepDemandSharePct: targetingMix
          .filter((t) => t.tier === '30' || t.tier === '50')
          .reduce((s, t) => s + t.sharePct, 0),
      },
      supply: {
        availableUnits: rollup.totals.availableUnits,
        totalUnits: rollup.totals.totalUnits,
      },
      targetingMix,
      marketStudy: {
        captureRatePct,
        maxAcceptableCaptureRatePct: MARKET_STUDY.maxCaptureRatePct,
        // Lower capture than the §6.1 ceiling = a demonstrably under-served
        // submarket; null (no demand yet) is not a pass.
        meetsCaptureThreshold:
          captureRatePct != null && captureRatePct <= MARKET_STUDY.maxCaptureRatePct,
      },
      basisBoost: {
        ...qctCoverage,
        boostPct: LOCATION_SCORING.basisBoostPct,
        eligible: qctCoverage.qctOrDdaProperties > 0,
      },
    };
  }

  private async getQctCoverage(account: GeographicAccount): Promise<{
    properties: number;
    qctOrDdaProperties: number;
  }> {
    const res = await query(
      `SELECT p.city AS city, p.is_qct AS is_qct, p.is_dda AS is_dda
         FROM properties p`,
    );
    let properties = 0;
    let qctOrDda = 0;
    for (const r of res.rows as { city: string | null; is_qct: boolean; is_dda: boolean }[]) {
      if (cityToGeographicAccount(r.city) !== account) continue;
      properties += 1;
      if (r.is_qct || r.is_dda) qctOrDda += 1;
    }
    return { properties, qctOrDdaProperties: qctOrDda };
  }
}

export interface DemandPacket {
  account: GeographicAccount;
  accountLabel: string;
  generatedAt: string;
  demand: {
    qualifiedApplicants: number;
    waitlistDepth: number;
    deepDemandSharePct: number;
  };
  supply: {
    availableUnits: number;
    totalUnits: number;
  };
  targetingMix: Array<{ tier: AmiTier; qualifiedApplicants: number; sharePct: number }>;
  marketStudy: {
    captureRatePct: number | null;
    maxAcceptableCaptureRatePct: number;
    meetsCaptureThreshold: boolean;
  };
  basisBoost: {
    properties: number;
    qctOrDdaProperties: number;
    boostPct: number;
    eligible: boolean;
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
