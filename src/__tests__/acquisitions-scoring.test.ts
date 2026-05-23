/**
 * Unit tests for src/modules/acquisitions/scoring.ts.
 *
 * scoreProject is pure (demand passed in), so no DB mock. Covers every scoring
 * branch: §7.4.1 low-rent tiers + the "at or below" cumulative logic, §7.4.2
 * election bonus, §7.4.3 service sum + cap, §7.3.1 QCT/DDA, the §6.1 capture
 * rate, and the eligibility subset math.
 */
import {
  scoreProject,
  FUNNEL_MAX_POINTS,
  type ScorableProject,
} from '../modules/acquisitions/scoring';
import type { ResidentService } from '../modules/acquisitions/qap-2026';

function project(overrides: Partial<ScorableProject> = {}): ScorableProject {
  return {
    geographicAccount: 'CLARK',
    electionKind: 'STD_40_60',
    totalUnits: 100,
    units30Ami: 0,
    units50Ami: 0,
    units60Ami: 0,
    isQct: false,
    isDda: false,
    residentServices: [],
    ...overrides,
  };
}

const points = (s: ReturnType<typeof scoreProject>, key: string) =>
  s.criteria.find((c) => c.key === key)!.points;

describe('FUNNEL_MAX_POINTS', () => {
  it('sums the four funnel-relevant criteria to 17', () => {
    expect(FUNNEL_MAX_POINTS).toBe(17); // 6 + 2 + 6 + 3
  });
});

describe('§7.4.1 low-rent targeting', () => {
  it('awards 6 pts at ≥10% of units ≤30% AMI', () => {
    expect(points(scoreProject(project({ units30Ami: 10 }), 0), 'low_rent_targeting')).toBe(6);
  });

  it('awards 4 pts at ≥5% (but <10%) of units ≤30% AMI', () => {
    expect(points(scoreProject(project({ units30Ami: 5 }), 0), 'low_rent_targeting')).toBe(4);
  });

  it('awards 3 pts at ≥20% of units ≤50% AMI', () => {
    expect(points(scoreProject(project({ units50Ami: 20 }), 0), 'low_rent_targeting')).toBe(3);
  });

  it('awards 2 pts at ≥10% (but <20%) of units ≤50% AMI', () => {
    expect(points(scoreProject(project({ units50Ami: 10 }), 0), 'low_rent_targeting')).toBe(2);
  });

  it('awards 1 pt at ≥40% of units ≤60% AMI', () => {
    expect(points(scoreProject(project({ units60Ami: 40 }), 0), 'low_rent_targeting')).toBe(1);
  });

  it('awards 0 when no threshold is met', () => {
    expect(points(scoreProject(project({ units60Ami: 10 }), 0), 'low_rent_targeting')).toBe(0);
  });

  it('counts deeper tiers cumulatively toward shallower thresholds (at-or-below)', () => {
    // 5 units @30% + 5 @50% = 10% ≤50% (→2pts) but also 5% ≤30% (→4pts).
    // Highest-first means the 30%@5% tier (4pts) wins.
    const s = scoreProject(project({ units30Ami: 5, units50Ami: 5 }), 0);
    expect(points(s, 'low_rent_targeting')).toBe(4);
  });

  it('awards 0 with zero total units', () => {
    const s = scoreProject(project({ totalUnits: 0, units30Ami: 0 }), 0);
    expect(points(s, 'low_rent_targeting')).toBe(0);
    expect(s.criteria[0].detail).toMatch(/no units/i);
  });
});

describe('§7.4.2 low-income targeting', () => {
  it('awards 2 pts for the 20%@50% election', () => {
    expect(points(scoreProject(project({ electionKind: 'STD_20_50' }), 0), 'low_income_targeting')).toBe(2);
  });

  it('awards 2 pts for the average-income election', () => {
    expect(points(scoreProject(project({ electionKind: 'AVERAGE_INCOME' }), 0), 'low_income_targeting')).toBe(2);
  });

  it('awards 0 for the standard 40%@60% election', () => {
    expect(points(scoreProject(project({ electionKind: 'STD_40_60' }), 0), 'low_income_targeting')).toBe(0);
  });
});

describe('§7.4.3 resident services', () => {
  it('awards 0 with no services', () => {
    expect(points(scoreProject(project(), 0), 'resident_services')).toBe(0);
  });

  it('sums per-service points (case management = 2)', () => {
    expect(points(scoreProject(project({ residentServices: ['case_management'] }), 0), 'resident_services')).toBe(2);
  });

  it('caps at the section maximum of 6', () => {
    const all: ResidentService[] = [
      'after_school',
      'job_training',
      'health_screening',
      'financial_literacy',
      'transportation',
      'case_management',
    ]; // raw = 7
    expect(points(scoreProject(project({ residentServices: all }), 0), 'resident_services')).toBe(6);
  });

  it('ignores unknown service keys', () => {
    const s = scoreProject(
      project({ residentServices: ['after_school', 'bogus' as ResidentService] }),
      0,
    );
    expect(points(s, 'resident_services')).toBe(1);
  });
});

describe('§7.3.1 location (QCT/DDA)', () => {
  it('awards 3 pts for a QCT', () => {
    expect(points(scoreProject(project({ isQct: true }), 0), 'location')).toBe(3);
  });

  it('awards 3 pts for a DDA', () => {
    expect(points(scoreProject(project({ isDda: true }), 0), 'location')).toBe(3);
  });

  it('does not double-count QCT + DDA (it is a flag, max 3)', () => {
    expect(points(scoreProject(project({ isQct: true, isDda: true }), 0), 'location')).toBe(3);
  });

  it('awards 0 for neither, and basisBoost is ineligible', () => {
    const s = scoreProject(project(), 0);
    expect(points(s, 'location')).toBe(0);
    expect(s.basisBoost.eligible).toBe(false);
  });

  it('sets basisBoost eligible + 30% when in a QCT/DDA', () => {
    const s = scoreProject(project({ isDda: true }), 0);
    expect(s.basisBoost).toEqual({ eligible: true, boostPct: 30 });
  });
});

describe('§6.1 market-study capture rate', () => {
  it('is null with zero demand and does not meet the threshold', () => {
    const s = scoreProject(project({ units50Ami: 20 }), 0);
    expect(s.marketStudy.captureRatePct).toBeNull();
    expect(s.marketStudy.meetsThreshold).toBe(false);
  });

  it('computes affordable units / demand and passes under the 30% ceiling', () => {
    const s = scoreProject(project({ units50Ami: 20 }), 100); // 20/100 = 20%
    expect(s.marketStudy.affordableUnits).toBe(20);
    expect(s.marketStudy.captureRatePct).toBe(20);
    expect(s.marketStudy.meetsThreshold).toBe(true);
  });

  it('fails when capture rate exceeds the 30% ceiling', () => {
    const s = scoreProject(project({ units50Ami: 40 }), 100); // 40%
    expect(s.marketStudy.captureRatePct).toBe(40);
    expect(s.marketStudy.meetsThreshold).toBe(false);
  });

  it('passes exactly at the 30% boundary', () => {
    const s = scoreProject(project({ units60Ami: 30 }), 100); // 30%
    expect(s.marketStudy.meetsThreshold).toBe(true);
  });
});

describe('total score + eligibility', () => {
  it('scores a maximal project at 17/17 (100% of the subset)', () => {
    const s = scoreProject(
      project({
        units30Ami: 10, // 6
        electionKind: 'STD_20_50', // 2
        residentServices: ['case_management', 'after_school', 'job_training', 'health_screening', 'financial_literacy'], // 6
        isQct: true, // 3
      }),
      50,
    );
    expect(s.funnelPoints).toBe(17);
    expect(s.funnelMaxPoints).toBe(17);
    expect(s.eligibility.subsetPct).toBe(100);
    expect(s.eligibility.minPct).toBe(60);
  });

  it('computes subsetPct from earned / max', () => {
    // low-rent 1 + location 3 = 4 of 17 → 23.5%
    const s = scoreProject(project({ units60Ami: 40, isQct: true }), 0);
    expect(s.funnelPoints).toBe(4);
    expect(s.eligibility.subsetPct).toBe(23.5);
  });
});
