/**
 * Project Scoring Tool — scores a candidate LIHTC project against the focused,
 * funnel-relevant QAP subset (Phase 2).
 *
 * The thesis carries through from Phase 1: the funnel's AMI-qualified demand is
 * the asset that wins credits. Phase 1 measured the demand; Phase 2 scores a
 * *project* against the criteria that demand makes credible — and joins the
 * demand back in as the §6.1 market-study check.
 *
 * Scored here (funnel-relevant subset only):
 *   §7.4.1 Low-Rent Targeting      (6 pts) — share of units at deep AMI tiers
 *   §7.4.2 Low-Income Targeting    (2 pts) — deeper set-aside election
 *   §7.4.3 Resident Services       (6 pts) — committed on-site services
 *   §7.3.1 Location / basis boost  (3 pts) — QCT/DDA siting
 *                                  ─────────
 *                          max     17 pts
 *
 * The full 97-point §7 rubric, pro-forma feasibility, and developer-capacity
 * scoring are intentionally out of scope (see qap-2026.ts). This is a pure
 * function: demand is passed in (fetched by the service) so scoring stays
 * deterministic and unit-testable without a database.
 */
import {
  LOW_RENT_TARGETING,
  LOW_RENT_TARGETING_MAX_POINTS,
  LOW_INCOME_TARGETING,
  RESIDENT_SERVICES,
  RESIDENT_SERVICES_MAX_POINTS,
  LOCATION_SCORING,
  MARKET_STUDY,
  MIN_ELIGIBILITY_PCT,
  RENT_ELECTIONS,
  type ElectionKind,
  type ResidentService,
  type GeographicAccount,
} from './qap-2026';

/** The project commitments scoring reads. Mirrors the persisted acq_projects. */
export interface ScorableProject {
  geographicAccount: GeographicAccount;
  electionKind: ElectionKind;
  totalUnits: number;
  /** Units committed AT each AMI tier (disjoint bands, not cumulative). */
  units30Ami: number;
  units50Ami: number;
  units60Ami: number;
  isQct: boolean;
  isDda: boolean;
  residentServices: ResidentService[];
}

export interface CriterionScore {
  key: string;
  section: string;
  label: string;
  points: number;
  maxPoints: number;
  detail: string;
}

export interface ProjectScore {
  funnelPoints: number;
  funnelMaxPoints: number;
  criteria: CriterionScore[];
  marketStudy: {
    affordableUnits: number;
    qualifiedDemand: number;
    captureRatePct: number | null;
    maxAcceptableCaptureRatePct: number;
    meetsThreshold: boolean;
  };
  basisBoost: {
    eligible: boolean;
    boostPct: number;
  };
  eligibility: {
    minPct: number;
    subsetPct: number;
    note: string;
  };
}

/** Funnel-relevant maximum: the four scored criteria sum to 17. */
export const FUNNEL_MAX_POINTS =
  LOW_RENT_TARGETING_MAX_POINTS +
  LOW_INCOME_TARGETING.maxPoints +
  RESIDENT_SERVICES_MAX_POINTS +
  LOCATION_SCORING.qctDdaPoints;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Total units committed at or below the funnel's restricted tiers (≤60% AMI). */
function affordableUnits(p: ScorableProject): number {
  return p.units30Ami + p.units50Ami + p.units60Ami;
}

/**
 * §7.4.1 — points scale with the share of units at the deepest rent tiers.
 * `unitSharePct` is measured "at or below" the tier's AMI ceiling, so deep
 * (30%) units also count toward the 50% and 60% thresholds. LOW_RENT_TARGETING
 * is highest-first, so the first qualifying tier is the best score.
 */
function scoreLowRent(p: ScorableProject): CriterionScore {
  const base: Omit<CriterionScore, 'points' | 'detail'> = {
    key: 'low_rent_targeting',
    section: '§7.4.1',
    label: 'Low-Rent Targeting',
    maxPoints: LOW_RENT_TARGETING_MAX_POINTS,
  };
  if (p.totalUnits <= 0) {
    return { ...base, points: 0, detail: 'No units defined.' };
  }
  const shareAtOrBelow = (ami: 30 | 50 | 60): number => {
    let units = 0;
    if (ami >= 30) units += p.units30Ami;
    if (ami >= 50) units += p.units50Ami;
    if (ami >= 60) units += p.units60Ami;
    return (units / p.totalUnits) * 100;
  };
  for (const tier of LOW_RENT_TARGETING) {
    if (shareAtOrBelow(tier.amiPct) >= tier.unitSharePct) {
      return {
        ...base,
        points: tier.points,
        detail: `${round1(shareAtOrBelow(tier.amiPct))}% of units at ≤${tier.amiPct}% AMI (≥${tier.unitSharePct}% threshold).`,
      };
    }
  }
  return {
    ...base,
    points: 0,
    detail: 'Unit mix does not meet the shallowest low-rent threshold.',
  };
}

/** §7.4.2 — flat bonus for electing a deeper set-aside than the standard 40%@60%. */
function scoreLowIncome(p: ScorableProject): CriterionScore {
  const qualifies = LOW_INCOME_TARGETING.qualifyingElections.includes(p.electionKind);
  return {
    key: 'low_income_targeting',
    section: '§7.4.2',
    label: 'Low-Income Targeting',
    points: qualifies ? LOW_INCOME_TARGETING.maxPoints : 0,
    maxPoints: LOW_INCOME_TARGETING.maxPoints,
    detail: qualifies
      ? `Election "${RENT_ELECTIONS[p.electionKind].label}" earns the deep-targeting bonus.`
      : `Election "${RENT_ELECTIONS[p.electionKind].label}" does not earn the bonus (electing 20%@50% or average-income would).`,
  };
}

/** §7.4.3 — sum of committed on-site services, capped at the section max. */
function scoreResidentServices(p: ScorableProject): CriterionScore {
  const selected = p.residentServices.filter((s) => s in RESIDENT_SERVICES);
  const raw = selected.reduce((sum, key) => sum + RESIDENT_SERVICES[key].points, 0);
  const points = Math.min(raw, RESIDENT_SERVICES_MAX_POINTS);
  return {
    key: 'resident_services',
    section: '§7.4.3',
    label: 'Resident Services',
    points,
    maxPoints: RESIDENT_SERVICES_MAX_POINTS,
    detail:
      selected.length === 0
        ? 'No services committed.'
        : `${selected.length} service${selected.length === 1 ? '' : 's'} committed (${raw} raw pts${raw > RESIDENT_SERVICES_MAX_POINTS ? `, capped at ${RESIDENT_SERVICES_MAX_POINTS}` : ''}).`,
  };
}

/** §7.3.1 / §11 — siting in a HUD QCT or DDA earns points and the basis boost. */
function scoreLocation(p: ScorableProject): CriterionScore {
  const eligible = p.isQct || p.isDda;
  const where = p.isQct && p.isDda ? 'QCT + DDA' : p.isQct ? 'QCT' : p.isDda ? 'DDA' : 'neither';
  return {
    key: 'location',
    section: '§7.3.1',
    label: 'Location (QCT/DDA)',
    points: eligible ? LOCATION_SCORING.qctDdaPoints : 0,
    maxPoints: LOCATION_SCORING.qctDdaPoints,
    detail: eligible
      ? `Sited in ${where} — also unlocks the §11 +${LOCATION_SCORING.basisBoostPct}% basis boost.`
      : 'Not in a QCT or DDA.',
  };
}

/**
 * Score a candidate project against the focused QAP subset, joining funnel
 * demand for the §6.1 market-study check. `qualifiedDemand` is the count of
 * AMI-qualified applicants in the project's geographic account (from the
 * Demand-Evidence Engine).
 */
export function scoreProject(p: ScorableProject, qualifiedDemand: number): ProjectScore {
  const criteria = [
    scoreLowRent(p),
    scoreLowIncome(p),
    scoreResidentServices(p),
    scoreLocation(p),
  ];
  const funnelPoints = criteria.reduce((sum, c) => sum + c.points, 0);

  // §6.1 capture rate: the project's affordable units as a share of the
  // qualified demand it would draw from. Lower = a demonstrably under-served
  // submarket. Null (no demand captured yet) is not a pass.
  const affordable = affordableUnits(p);
  const captureRatePct =
    qualifiedDemand > 0 ? round1((affordable / qualifiedDemand) * 100) : null;

  const subsetPct = round1((funnelPoints / FUNNEL_MAX_POINTS) * 100);

  return {
    funnelPoints,
    funnelMaxPoints: FUNNEL_MAX_POINTS,
    criteria,
    marketStudy: {
      affordableUnits: affordable,
      qualifiedDemand,
      captureRatePct,
      maxAcceptableCaptureRatePct: MARKET_STUDY.maxCaptureRatePct,
      meetsThreshold:
        captureRatePct != null && captureRatePct <= MARKET_STUDY.maxCaptureRatePct,
    },
    basisBoost: {
      eligible: p.isQct || p.isDda,
      boostPct: LOCATION_SCORING.basisBoostPct,
    },
    eligibility: {
      minPct: MIN_ELIGIBILITY_PCT,
      subsetPct,
      // Honest scoping: this is the funnel-relevant subset, not the full rubric.
      note: `Funnel-relevant subset score. Full QAP eligibility requires ${MIN_ELIGIBILITY_PCT}% of the complete §7 rubric (feasibility, developer capacity, etc. — out of scope).`,
    },
  };
}
