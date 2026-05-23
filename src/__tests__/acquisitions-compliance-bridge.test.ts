/**
 * Pure-function tests for src/modules/acquisitions/compliance-bridge.ts.
 *
 * No DB, no mocks: the designation math is the LURA-commitment truth, so it's
 * exercised directly. Covers ceiling derivation, target split, plan rollup
 * (committed vs assigned, meetsCommitment), and assignment validation.
 */
import {
  amiCeilingPct,
  designationTargets,
  buildDesignationPlan,
  validateAssignments,
  RESTRICTED_DESIGNATIONS,
  type CommittedMix,
  type DesignationTargets,
} from '../modules/acquisitions/compliance-bridge';

const mix = (over: Partial<CommittedMix> = {}): CommittedMix => ({
  totalUnits: 100,
  units30Ami: 10,
  units50Ami: 20,
  units60Ami: 10,
  electionKind: 'STD_40_60',
  ...over,
});

const counts = (over: Partial<DesignationTargets> = {}): DesignationTargets => ({
  '30': 0,
  '50': 0,
  '60': 0,
  market: 0,
  ...over,
});

describe('amiCeilingPct', () => {
  it('maps restricted tiers to their AMI ceiling and market to null', () => {
    expect(amiCeilingPct('30')).toBe(30);
    expect(amiCeilingPct('50')).toBe(50);
    expect(amiCeilingPct('60')).toBe(60);
    expect(amiCeilingPct('market')).toBeNull();
  });
});

describe('designationTargets', () => {
  it('splits restricted commitments and balances the rest to market', () => {
    expect(designationTargets(mix())).toEqual({ '30': 10, '50': 20, '60': 10, market: 60 });
  });

  it('clamps market at zero when restricted exceeds total (defensive)', () => {
    const t = designationTargets(mix({ totalUnits: 30, units30Ami: 20, units50Ami: 20, units60Ami: 0 }));
    expect(t.market).toBe(0);
  });

  it('RESTRICTED_DESIGNATIONS lists the three deep tiers, deepest first', () => {
    expect(RESTRICTED_DESIGNATIONS).toEqual(['30', '50', '60']);
  });
});

describe('buildDesignationPlan', () => {
  it('reports per-tier committed/assigned/remaining and a shortfall', () => {
    const plan = buildDesignationPlan(mix(), counts({ '30': 4, '50': 20, '60': 0 }), 100);
    expect(plan.committedRestricted).toBe(40);
    expect(plan.assignedRestricted).toBe(24);
    expect(plan.propertyUnits).toBe(100);
    expect(plan.meetsCommitment).toBe(false);

    const byTier = Object.fromEntries(plan.rows.map((r) => [r.designation, r]));
    expect(byTier['30']).toMatchObject({ committed: 10, assigned: 4, remaining: 6, ceilingAmiPct: 30 });
    expect(byTier['60']).toMatchObject({ committed: 10, assigned: 0, remaining: 10 });
    expect(byTier['market']).toMatchObject({ committed: 60, ceilingAmiPct: null });
    expect(plan.electionLabel).toBeTruthy();
  });

  it('meetsCommitment once every restricted tier is designated at or above target', () => {
    const plan = buildDesignationPlan(mix(), counts({ '30': 10, '50': 25, '60': 10 }), 100);
    expect(plan.meetsCommitment).toBe(true);
    expect(plan.note).toContain('40');
  });

  it('treats a no-restricted-units award as trivially met', () => {
    const plan = buildDesignationPlan(
      mix({ units30Ami: 0, units50Ami: 0, units60Ami: 0 }),
      counts(),
      50,
    );
    expect(plan.committedRestricted).toBe(0);
    expect(plan.meetsCommitment).toBe(true);
    expect(plan.note).toMatch(/no restricted units/i);
  });
});

describe('validateAssignments', () => {
  const propertyUnits = new Set(['u1', 'u2', 'u3']);

  it('accepts assignments to units that belong to the property', () => {
    const errs = validateAssignments(
      [
        { unitId: 'u1', designation: '30' },
        { unitId: 'u2', designation: 'market' },
      ],
      propertyUnits,
    );
    expect(errs).toEqual([]);
  });

  it('flags units that do not belong to the bound property', () => {
    const errs = validateAssignments([{ unitId: 'ghost', designation: '50' }], propertyUnits);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatchObject({ unitId: 'ghost' });
    expect(errs[0].reason).toMatch(/belong/i);
  });

  it('flags duplicate assignments for the same unit', () => {
    const errs = validateAssignments(
      [
        { unitId: 'u1', designation: '30' },
        { unitId: 'u1', designation: '50' },
      ],
      propertyUnits,
    );
    expect(errs.some((e) => /duplicate/i.test(e.reason))).toBe(true);
  });

  it('flags an invalid designation value', () => {
    const errs = validateAssignments(
      [{ unitId: 'u1', designation: '70' as never }],
      propertyUnits,
    );
    expect(errs.some((e) => /invalid designation/i.test(e.reason))).toBe(true);
  });
});
