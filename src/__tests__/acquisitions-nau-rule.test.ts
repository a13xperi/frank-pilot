/**
 * QAP acquisitions Phase 3.2 — Next Available Unit Rule (NAU).
 *
 * Three layers:
 *  1. Pure math (comparableUnit, recommendedRentAction) — comparability
 *     (same-property, bedroom, tier-depth, market-excluded) and the verdict →
 *     rent-action mapping under IRC §42(g)(2)(D)(ii).
 *  2. Service (RecertComplianceService) — an over_income verdict opens a NAU
 *     obligation + stamps acq.nau_triggered; resolveNau credits a comparable
 *     rented unit + stamps acq.nau_satisfied; a non-comparable unit is rejected.
 *  3. Scope-routing regression — both new tape kinds route to applicant_id=null.
 *
 * `query` and the compliance tape are mocked so nothing touches Postgres.
 */
import type { QueryResult } from 'pg';
import {
  comparableUnit,
  recommendedRentAction,
  type NauUnit,
} from '../modules/acquisitions/compliance-bridge';
import { RecertComplianceService } from '../modules/acquisitions/recert-compliance';
import { query } from '../config/database';

const mockStamp = jest.fn().mockResolvedValue(undefined);
const stamp = mockStamp;

jest.mock('../config/database', () => ({ query: jest.fn() }));
jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('../modules/tape/repository', () => ({ PgTapeRepository: jest.fn() }));
jest.mock('../modules/tape/service', () => ({
  createTapeService: () => ({ stamp: (...args: unknown[]) => mockStamp(...args) }),
}));

function qr<T extends Record<string, unknown>>(rows: T[]): QueryResult<T> {
  return { rows, rowCount: rows.length } as unknown as QueryResult<T>;
}

const mockQuery = query as jest.MockedFunction<typeof query>;

// ---------------------------------------------------------------------------
// 1a. Pure math — comparableUnit
// ---------------------------------------------------------------------------
const over: NauUnit = { propertyId: 'prop-1', bedrooms: 2, amiDesignation: '60' };

describe('comparableUnit', () => {
  it('accepts a same-tier, same-bedroom unit in the same property', () => {
    expect(comparableUnit(over, { propertyId: 'prop-1', bedrooms: 2, amiDesignation: '60' })).toBe(true);
  });

  it('accepts a deeper-tier candidate (30 is deeper than 60)', () => {
    expect(comparableUnit(over, { propertyId: 'prop-1', bedrooms: 2, amiDesignation: '30' })).toBe(true);
  });

  it('accepts a larger candidate (more bedrooms)', () => {
    expect(comparableUnit(over, { propertyId: 'prop-1', bedrooms: 3, amiDesignation: '60' })).toBe(true);
  });

  it('rejects a different property', () => {
    expect(comparableUnit(over, { propertyId: 'prop-2', bedrooms: 2, amiDesignation: '60' })).toBe(false);
  });

  it('rejects fewer bedrooms', () => {
    expect(comparableUnit(over, { propertyId: 'prop-1', bedrooms: 1, amiDesignation: '60' })).toBe(false);
  });

  it('rejects a shallower tier (a 60 cannot satisfy a 30)', () => {
    const over30: NauUnit = { propertyId: 'prop-1', bedrooms: 2, amiDesignation: '30' };
    expect(comparableUnit(over30, { propertyId: 'prop-1', bedrooms: 2, amiDesignation: '60' })).toBe(false);
  });

  it('rejects a market candidate (never qualifies)', () => {
    expect(comparableUnit(over, { propertyId: 'prop-1', bedrooms: 2, amiDesignation: 'market' })).toBe(false);
  });

  it('rejects an undesignated candidate', () => {
    expect(comparableUnit(over, { propertyId: 'prop-1', bedrooms: 2, amiDesignation: null })).toBe(false);
  });

  it('rejects when the over-income unit itself is not restricted', () => {
    const overMarket: NauUnit = { propertyId: 'prop-1', bedrooms: 2, amiDesignation: 'market' };
    expect(comparableUnit(overMarket, { propertyId: 'prop-1', bedrooms: 2, amiDesignation: '30' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 1b. Pure math — recommendedRentAction
// ---------------------------------------------------------------------------
describe('recommendedRentAction', () => {
  it('qualified → none', () => {
    expect(recommendedRentAction('qualified').action).toBe('none');
  });
  it('not_restricted → none', () => {
    expect(recommendedRentAction('not_restricted').action).toBe('none');
  });
  it('indeterminate → none', () => {
    expect(recommendedRentAction('indeterminate').action).toBe('none');
  });
  it('over_income_aur → hold_restricted', () => {
    expect(recommendedRentAction('over_income_aur').action).toBe('hold_restricted');
  });
  it('over_income → hold_pending_nau', () => {
    expect(recommendedRentAction('over_income').action).toBe('hold_pending_nau');
  });
  it('over_income with nauLost → market_rent', () => {
    expect(recommendedRentAction('over_income', { nauLost: true }).action).toBe('market_rent');
  });
});

// ---------------------------------------------------------------------------
// 2. Service
// ---------------------------------------------------------------------------
function resolveRow(over: Record<string, unknown> = {}) {
  return {
    id: 'recert-1',
    property_id: 'prop-1',
    tenant_name: 'Jane Doe',
    new_annual_income: '80000', // vs 60% limit 50000 → over 140% (70000) → over_income
    previous_annual_income: '48000',
    application_id: 'app-1',
    claimed_unit_id: 'unit-1',
    household_size: 3,
    application_income: '45000',
    unit_id: 'unit-1',
    unit_number: '204',
    ami_designation: '60',
    bedrooms: 2,
    ami_area: 'Clark County',
    ...over,
  };
}

const limitRow = { ami_30_percent: '25000', ami_50_percent: '42000', ami_60_percent: '50000' };

const service = new RecertComplianceService();

beforeEach(() => {
  mockQuery.mockReset();
  stamp.mockClear();
});

describe('RecertComplianceService.check — NAU trigger', () => {
  it('over_income opens nau_status and stamps acq.nau_triggered (subjectId null)', async () => {
    mockQuery
      .mockResolvedValueOnce(qr([resolveRow()])) // chain resolve
      .mockResolvedValueOnce(qr([limitRow])) // ami_limits this year
      .mockResolvedValueOnce(qr([])) // persist UPDATE
      .mockResolvedValueOnce(qr([])) // openNau UPDATE
      .mockResolvedValue(qr([]));

    const r = await service.check('recert-1', { actorId: 'rev-1' });
    expect(r!.check.verdict).toBe('over_income');

    // openNau UPDATE fired with nau_status = 'open'
    const nauUpdate = mockQuery.mock.calls.find((c) => String(c[0]).includes("nau_status = 'open'"));
    expect(nauUpdate).toBeDefined();

    // tape stamped acq.nau_triggered, global-scope (subjectId null)
    expect(stamp).toHaveBeenCalledTimes(2); // recert_income_checked + nau_triggered
    const nauStamp = stamp.mock.calls.find((c) => (c[0] as any).kind === 'acq.nau_triggered');
    expect(nauStamp).toBeDefined();
    const payload = (nauStamp![0] as any).payload;
    expect(payload.subjectId).toBeNull();
    expect(payload.evidence.recertId).toBe('recert-1');
    expect(payload.evidence.verdict).toBe('over_income');
  });

  it('does not open NAU for an over_income_aur (≤140%) verdict', async () => {
    mockQuery
      .mockResolvedValueOnce(qr([resolveRow({ new_annual_income: '62000' })])) // 62000 ≤ 70000 → aur
      .mockResolvedValueOnce(qr([limitRow]))
      .mockResolvedValue(qr([]));

    const r = await service.check('recert-1', { actorId: 'rev-1' });
    expect(r!.check.verdict).toBe('over_income_aur');
    const nauUpdate = mockQuery.mock.calls.find((c) => String(c[0]).includes("nau_status = 'open'"));
    expect(nauUpdate).toBeUndefined();
    const nauStamp = stamp.mock.calls.find((c) => (c[0] as any).kind === 'acq.nau_triggered');
    expect(nauStamp).toBeUndefined();
  });
});

describe('RecertComplianceService.resolveNau', () => {
  function overIncomeRecertRow(over: Record<string, unknown> = {}) {
    return {
      id: 'recert-1',
      property_id: 'prop-1',
      tenant_name: 'Jane Doe',
      nau_status: 'open',
      income_ceiling_verdict: 'over_income',
      application_id: 'app-1',
      household_size: 3,
      unit_id: 'unit-1',
      unit_number: '204',
      ami_designation: '60',
      bedrooms: 2,
      ami_area: 'Clark County',
      ...over,
    };
  }

  function candidateRow(over: Record<string, unknown> = {}) {
    return {
      id: 'unit-9',
      property_id: 'prop-1',
      unit_number: '310',
      bedrooms: 2,
      ami_designation: '60',
      status: 'occupied',
      claimed_unit: 'app-77',
      ...over,
    };
  }

  it('happy path → satisfied + acq.nau_satisfied stamped (subjectId null)', async () => {
    mockQuery
      .mockResolvedValueOnce(qr([overIncomeRecertRow()])) // load recert + unit
      .mockResolvedValueOnce(qr([candidateRow()])) // load candidate
      .mockResolvedValueOnce(qr([])) // UPDATE satisfied
      .mockResolvedValue(qr([]));

    const ctx = await service.resolveNau('recert-1', 'unit-9', 'rev-1', 'rented to qualifying household');
    expect(ctx.recertId).toBe('recert-1');

    const satUpdate = mockQuery.mock.calls.find((c) => String(c[0]).includes("nau_status = 'satisfied'"));
    expect(satUpdate).toBeDefined();

    expect(stamp).toHaveBeenCalledTimes(1);
    const s = stamp.mock.calls[0][0] as any;
    expect(s.kind).toBe('acq.nau_satisfied');
    expect(s.payload.subjectId).toBeNull();
    expect(s.payload.evidence.recertId).toBe('recert-1');
    expect(s.payload.evidence.resolvingUnitId).toBe('unit-9');
  });

  it('rejects a non-comparable resolving unit (fewer bedrooms)', async () => {
    mockQuery
      .mockResolvedValueOnce(qr([overIncomeRecertRow()]))
      .mockResolvedValueOnce(qr([candidateRow({ bedrooms: 1 })]))
      .mockResolvedValue(qr([]));

    await expect(service.resolveNau('recert-1', 'unit-9', 'rev-1', 'x')).rejects.toThrow(/not comparable/i);
    // no satisfied UPDATE, no stamp
    expect(mockQuery.mock.calls.find((c) => String(c[0]).includes("nau_status = 'satisfied'"))).toBeUndefined();
    expect(stamp).not.toHaveBeenCalled();
  });

  it('rejects a market resolving unit (never qualifies)', async () => {
    mockQuery
      .mockResolvedValueOnce(qr([overIncomeRecertRow()]))
      .mockResolvedValueOnce(qr([candidateRow({ ami_designation: 'market' })]))
      .mockResolvedValue(qr([]));

    await expect(service.resolveNau('recert-1', 'unit-9', 'rev-1', 'x')).rejects.toThrow(/not comparable/i);
  });

  it('rejects a comparable but still-available (not rented) unit', async () => {
    mockQuery
      .mockResolvedValueOnce(qr([overIncomeRecertRow()]))
      .mockResolvedValueOnce(qr([candidateRow({ status: 'available', claimed_unit: null })]))
      .mockResolvedValue(qr([]));

    await expect(service.resolveNau('recert-1', 'unit-9', 'rev-1', 'x')).rejects.toThrow(/rented to a qualifying household/i);
  });

  it('rejects when the recert has no open NAU obligation', async () => {
    mockQuery
      .mockResolvedValueOnce(qr([overIncomeRecertRow({ nau_status: 'satisfied' })]))
      .mockResolvedValue(qr([]));

    await expect(service.resolveNau('recert-1', 'unit-9', 'rev-1', 'x')).rejects.toThrow(/not open/i);
  });

  it('rejects when the verdict is not over_income', async () => {
    mockQuery
      .mockResolvedValueOnce(qr([overIncomeRecertRow({ income_ceiling_verdict: 'qualified', nau_status: null })]))
      .mockResolvedValue(qr([]));

    await expect(service.resolveNau('recert-1', 'unit-9', 'rev-1', 'x')).rejects.toThrow(/no over-income verdict/i);
  });

  it('throws for an unknown recert', async () => {
    mockQuery.mockResolvedValueOnce(qr([]));
    await expect(service.resolveNau('nope', 'unit-9', 'rev-1', 'x')).rejects.toThrow(/not found/i);
  });
});

// ---------------------------------------------------------------------------
// 3. Scope-routing regression guard — both NAU kinds are global-scope.
//
// compliance_tape.applicant_id is FK'd to users(id). A non-null subjectId routes
// straight into that column and FK-violates in prod. Drive the REAL tape service
// (in-memory repo) to pin: subjectId:null → applicant_id null.
// ---------------------------------------------------------------------------
describe('tape scope routing (regression: NAU stamps are global-scope)', () => {
  const { createTapeService: realCreateTapeService } = jest.requireActual('../modules/tape/service');

  function captureRepo() {
    const inserted: Array<{ applicantId: string | null }> = [];
    const repo = {
      tail: async () => null,
      list: async () => [],
      insert: async (row: any) => {
        inserted.push({ applicantId: row.applicantId ?? null });
        return { id: 'entry-1', createdAt: new Date().toISOString(), ...row };
      },
    };
    return { repo, inserted };
  }

  function nauPayload(subjectId: string | null) {
    return {
      '@context': 'https://schema.org',
      '@type': 'AcquisitionComplianceEvent',
      actorId: 'rev-1',
      subjectId,
      ruleCitation: 'IRC 42(g)(2)(D)(ii) (Next Available Unit Rule)',
      evidence: { recertId: 'recert-1' },
    };
  }

  it('routes acq.nau_triggered (subjectId:null) to applicant_id=null', async () => {
    const { repo, inserted } = captureRepo();
    const realTape = realCreateTapeService(repo);
    await realTape.stamp({
      kind: 'acq.nau_triggered',
      payload: nauPayload(null),
      sessionId: 'sess-nau-1',
    });
    expect(inserted).toHaveLength(1);
    expect(inserted[0].applicantId).toBeNull();
  });

  it('routes acq.nau_satisfied (subjectId:null) to applicant_id=null', async () => {
    const { repo, inserted } = captureRepo();
    const realTape = realCreateTapeService(repo);
    await realTape.stamp({
      kind: 'acq.nau_satisfied',
      payload: nauPayload(null),
      sessionId: 'sess-nau-2',
    });
    expect(inserted).toHaveLength(1);
    expect(inserted[0].applicantId).toBeNull();
  });

  it('a non-null subjectId lands in applicant_id (the users-FK column) — why NAU must pass null', async () => {
    const { repo, inserted } = captureRepo();
    const realTape = realCreateTapeService(repo);
    await realTape.stamp({
      kind: 'acq.nau_satisfied',
      payload: nauPayload('recert-1'),
      sessionId: 'sess-nau-3',
    });
    expect(inserted[0].applicantId).toBe('recert-1');
  });
});
