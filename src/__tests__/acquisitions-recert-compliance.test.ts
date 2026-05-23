/**
 * QAP acquisitions Phase 3.1 — recert income-ceiling enforcement.
 *
 * Two layers:
 *  1. Pure math (evaluateRecertIncome) — verdict tiers, the 140% Available Unit
 *     Rule boundary, market/undesignated, and the indeterminate fallbacks.
 *  2. Service (RecertComplianceService) — resolves recert → application →
 *     claimed unit → designation, looks up the HUD limit (with prior-year
 *     fallback), evaluates, persists the snapshot, and stamps the tape.
 *
 * `query` and the compliance tape are mocked so nothing touches Postgres.
 */
import type { QueryResult } from 'pg';
import {
  evaluateRecertIncome,
  RECERT_AUR_FACTOR,
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
// 1. Pure math
// ---------------------------------------------------------------------------
describe('evaluateRecertIncome', () => {
  it('treats a market unit as not_restricted with no ceiling', () => {
    const r = evaluateRecertIncome({ designation: 'market', applicableLimit: null, householdIncome: 40000 });
    expect(r.verdict).toBe('not_restricted');
    expect(r.ceilingAmiPct).toBeNull();
    expect(r.aurThreshold).toBeNull();
  });

  it('treats an undesignated (null) unit as not_restricted', () => {
    const r = evaluateRecertIncome({ designation: null, applicableLimit: null, householdIncome: 40000 });
    expect(r.verdict).toBe('not_restricted');
  });

  it('qualifies income at or under the applicable limit', () => {
    const r = evaluateRecertIncome({ designation: '60', applicableLimit: 50000, householdIncome: 50000 });
    expect(r.verdict).toBe('qualified');
    expect(r.ceilingAmiPct).toBe(60);
    expect(r.pctOfLimit).toBe(100);
  });

  it('flags over_income_aur when income is over the limit but within 140%', () => {
    const r = evaluateRecertIncome({ designation: '50', applicableLimit: 50000, householdIncome: 60000 });
    expect(r.verdict).toBe('over_income_aur');
    expect(r.aurThreshold).toBe(50000 * RECERT_AUR_FACTOR);
  });

  it('treats income exactly at 140% as still over_income_aur (boundary inclusive)', () => {
    const limit = 50000;
    const r = evaluateRecertIncome({ designation: '30', applicableLimit: limit, householdIncome: limit * 1.4 });
    expect(r.verdict).toBe('over_income_aur');
  });

  it('flags over_income just past the 140% threshold', () => {
    const limit = 50000;
    const r = evaluateRecertIncome({ designation: '30', applicableLimit: limit, householdIncome: limit * 1.4 + 1 });
    expect(r.verdict).toBe('over_income');
  });

  it('is indeterminate when the limit is missing for a restricted unit', () => {
    const r = evaluateRecertIncome({ designation: '60', applicableLimit: null, householdIncome: 40000 });
    expect(r.verdict).toBe('indeterminate');
    expect(r.ceilingAmiPct).toBe(60);
  });

  it('is indeterminate when income is missing', () => {
    const r = evaluateRecertIncome({ designation: '60', applicableLimit: 50000, householdIncome: null });
    expect(r.verdict).toBe('indeterminate');
    expect(r.aurThreshold).toBe(50000 * RECERT_AUR_FACTOR);
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
    new_annual_income: '62000',
    previous_annual_income: '48000',
    application_id: 'app-1',
    claimed_unit_id: 'unit-1',
    household_size: 3,
    application_income: '45000',
    unit_id: 'unit-1',
    unit_number: '204',
    ami_designation: '60',
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

describe('RecertComplianceService.check', () => {
  it('returns null for an unknown recert', async () => {
    mockQuery.mockResolvedValueOnce(qr([]));
    const r = await service.check('nope', { persist: false, stamp: false });
    expect(r).toBeNull();
  });

  it('resolves the chain, evaluates over_income_aur, persists, and stamps', async () => {
    mockQuery
      .mockResolvedValueOnce(qr([resolveRow()])) // chain resolve
      .mockResolvedValueOnce(qr([limitRow])) // ami_limits this year
      .mockResolvedValueOnce(qr([])) // persist UPDATE
      .mockResolvedValue(qr([])); // any further

    const r = await service.check('recert-1', { actorId: 'rev-1' });
    expect(r).not.toBeNull();
    // income 62000 vs 60% limit 50000 → over but within 140% (70000)
    expect(r!.check.verdict).toBe('over_income_aur');
    expect(r!.context.designation).toBe('60');
    expect(r!.context.unitNumber).toBe('204');

    // persist UPDATE fired
    const updateCall = mockQuery.mock.calls.find((c) => String(c[0]).includes('UPDATE recertifications'));
    expect(updateCall).toBeDefined();

    // tape stamped as a GLOBAL-scope admin event. subjectId is FK'd to
    // users(id) via compliance_tape.applicant_id, so it MUST be null — the
    // recert id rides in evidence, never the scope key. (Regression: a recert
    // id in subjectId FK-violates on every restricted-unit stamp in prod.)
    expect(stamp).toHaveBeenCalledTimes(1);
    const payload = (stamp.mock.calls[0][0] as any).payload;
    expect((stamp.mock.calls[0][0] as any).kind).toBe('acq.recert_income_checked');
    expect(payload.subjectId).toBeNull();
    expect(payload.evidence.recertId).toBe('recert-1');
    expect(payload.evidence.verdict).toBe('over_income_aur');
  });

  it('falls back to the prior year when the current-year limit is absent', async () => {
    mockQuery
      .mockResolvedValueOnce(qr([resolveRow({ new_annual_income: '40000' })])) // chain
      .mockResolvedValueOnce(qr([])) // this year — empty
      .mockResolvedValueOnce(qr([limitRow])) // prior year
      .mockResolvedValue(qr([])); // persist + stamp path

    const r = await service.check('recert-1', { actorId: 'rev-1', stamp: false });
    expect(r!.check.verdict).toBe('qualified'); // 40000 <= 50000
    expect(r!.context.limitYear).toBe(new Date().getFullYear() - 1);
  });

  it('degrades to not_restricted when the unit is not resolved (market/no claim)', async () => {
    mockQuery
      .mockResolvedValueOnce(
        qr([resolveRow({ claimed_unit_id: null, unit_id: null, unit_number: null, ami_designation: null })]),
      )
      .mockResolvedValue(qr([]));

    const r = await service.check('recert-1', { persist: false, stamp: false });
    expect(r!.check.verdict).toBe('not_restricted');
    // no ami_limits lookup happens for an undesignated unit
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('honours an explicit income override', async () => {
    mockQuery
      .mockResolvedValueOnce(qr([resolveRow()]))
      .mockResolvedValueOnce(qr([limitRow]))
      .mockResolvedValue(qr([]));

    // override 80000 vs 50000 → over 140% (70000) → over_income
    const r = await service.check('recert-1', { income: 80000, persist: false, stamp: false });
    expect(r!.check.verdict).toBe('over_income');
    expect(r!.check.householdIncome).toBe(80000);
  });

  it('does not throw when the tape stamp fails', async () => {
    mockQuery
      .mockResolvedValueOnce(qr([resolveRow()]))
      .mockResolvedValueOnce(qr([limitRow]))
      .mockResolvedValue(qr([]));
    stamp.mockRejectedValueOnce(new Error('tape down'));

    await expect(service.check('recert-1', { persist: false, actorId: 'rev-1' })).resolves.not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Scope-routing regression guard
//
// The service-layer tests above mock createTapeService, so they never exercise
// how a payload's subjectId maps onto the DB row. compliance_tape.applicant_id
// is FK'd to users(id) -- a non-null subjectId routes the recert id straight
// into that column and FK-violates in prod. This block drives the REAL tape
// service (with an in-memory repo) to pin the contract: subjectId:null -> a
// global-scope insert with applicant_id null; a non-null subjectId -> that id in
// applicant_id (which is exactly why a recert stamp must pass null).
// ---------------------------------------------------------------------------
describe('tape scope routing (regression: recert stamps are global-scope)', () => {
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

  function recertPayload(subjectId: string | null) {
    return {
      '@context': 'https://schema.org',
      '@type': 'AcquisitionComplianceEvent',
      actorId: 'rev-1',
      subjectId,
      ruleCitation: 'IRC 42(g)(2)(D)(ii) (Available Unit Rule) + 26 CFR 1.42-5',
      evidence: { recertId: 'recert-1', verdict: 'over_income_aur' },
    };
  }

  it('routes a recert stamp (subjectId:null) to applicant_id=null -- never the users FK', async () => {
    const { repo, inserted } = captureRepo();
    const realTape = realCreateTapeService(repo);

    await realTape.stamp({
      kind: 'acq.recert_income_checked',
      payload: recertPayload(null),
      sessionId: 'sess-recert-1',
    });

    expect(inserted).toHaveLength(1);
    expect(inserted[0].applicantId).toBeNull();
  });

  it('a non-null subjectId lands in applicant_id (the users-FK column) -- why recert must pass null', async () => {
    const { repo, inserted } = captureRepo();
    const realTape = realCreateTapeService(repo);

    await realTape.stamp({
      kind: 'acq.recert_income_checked',
      payload: recertPayload('recert-1'),
      sessionId: 'sess-recert-2',
    });

    expect(inserted[0].applicantId).toBe('recert-1');
  });
});
