/**
 * Service-layer tests for src/modules/acquisitions/award-service.ts.
 *
 * `query` and `transaction` are mocked; the compliance tape is stubbed so a
 * stamp can't reach Postgres. Covers CRUD mapping, the CONFLICT/VALIDATION
 * error translation, the designation plan join (project mix + property counts),
 * and applyDesignations' validate → transactional write → best-effort stamp.
 */
import type { QueryResult } from 'pg';
import { AwardService, BridgeError } from '../modules/acquisitions/award-service';
import { query, transaction } from '../config/database';

// `mock`-prefixed so jest allows the reference inside the hoisted factory; the
// closure invokes it lazily, after the const below has initialized.
const mockStamp = jest.fn().mockResolvedValue(undefined);
const stamp = mockStamp;

jest.mock('../config/database', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));
jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('../modules/tape/repository', () => ({ PgTapeRepository: jest.fn() }));
jest.mock('../modules/tape/service', () => ({
  createTapeService: () => ({ stamp: (...args: unknown[]) => mockStamp(...args) }),
}));

function qr<T extends Record<string, unknown>>(rows: T[], rowCount?: number): QueryResult<T> {
  return { rows, rowCount: rowCount ?? rows.length } as unknown as QueryResult<T>;
}

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockTransaction = transaction as jest.MockedFunction<typeof transaction>;

function awardRow(over: Record<string, unknown> = {}) {
  return {
    id: 'award-1',
    acq_project_id: 'proj-1',
    property_id: null,
    status: 'reserved',
    reservation_amount: '1200000.00',
    award_date: '2026-05-20',
    placed_in_service_deadline: null,
    notes: null,
    created_by: 'user-1',
    created_at: '2026-05-22T00:00:00.000Z',
    updated_at: '2026-05-22T00:00:00.000Z',
    ...over,
  };
}

const service = new AwardService();

beforeEach(() => {
  mockQuery.mockReset();
  mockTransaction.mockReset();
  stamp.mockClear();
});

describe('AwardService CRUD', () => {
  it('list maps rows to camelCase, coercing amount to number and dates to YYYY-MM-DD', async () => {
    mockQuery.mockResolvedValueOnce(qr([awardRow()]));
    const [a] = await service.list();
    expect(a).toMatchObject({
      id: 'award-1',
      acqProjectId: 'proj-1',
      propertyId: null,
      status: 'reserved',
      reservationAmount: 1200000,
      awardDate: '2026-05-20',
      placedInServiceDeadline: null,
    });
  });

  it('create returns the row and stamps acq.award_recorded', async () => {
    mockQuery.mockResolvedValueOnce(qr([awardRow()]));
    const created = await service.create({ acqProjectId: 'proj-1' }, 'user-1');
    expect(created.id).toBe('award-1');
    expect(stamp).toHaveBeenCalledTimes(1);
    expect(stamp.mock.calls[0][0]).toMatchObject({ kind: 'acq.award_recorded' });
  });

  it('create maps a unique-violation to a CONFLICT BridgeError', async () => {
    mockQuery.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }));
    await expect(service.create({ acqProjectId: 'proj-1' }, 'user-1')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('create maps a FK violation to a VALIDATION BridgeError', async () => {
    mockQuery.mockRejectedValueOnce(Object.assign(new Error('fk'), { code: '23503' }));
    await expect(service.create({ acqProjectId: 'ghost' }, null)).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('remove reports whether a row was deleted', async () => {
    mockQuery.mockResolvedValueOnce(qr([], 1));
    expect(await service.remove('award-1')).toBe(true);
    mockQuery.mockResolvedValueOnce(qr([], 0));
    expect(await service.remove('gone')).toBe(false);
  });
});

describe('AwardService.designationPlan', () => {
  it('returns null for a missing award', async () => {
    mockQuery.mockResolvedValueOnce(qr([])); // get → none
    expect(await service.designationPlan('nope')).toBeNull();
  });

  it('throws NOT_BOUND when the award has no property', async () => {
    mockQuery.mockResolvedValueOnce(qr([awardRow()])); // property_id null
    await expect(service.designationPlan('award-1')).rejects.toMatchObject({ code: 'NOT_BOUND' });
  });

  it('joins the project mix with current unit counts into a plan', async () => {
    // 1) get award (bound), 2) project mix, 3) property designation counts
    mockQuery
      .mockResolvedValueOnce(qr([awardRow({ property_id: 'prop-1' })]))
      .mockResolvedValueOnce(
        qr([
          {
            name: 'Desert Vista',
            total_units: 100,
            units_30_ami: 10,
            units_50_ami: 20,
            units_60_ami: 0,
            election_kind: 'STD_40_60',
          },
        ]),
      )
      .mockResolvedValueOnce(
        qr([
          { ami_designation: '30', n: 4 },
          { ami_designation: '50', n: 20 },
          { ami_designation: null, n: 76 },
        ]),
      );

    const plan = await service.designationPlan('award-1');
    expect(plan).not.toBeNull();
    expect(plan!.committedRestricted).toBe(30);
    expect(plan!.assignedRestricted).toBe(24);
    expect(plan!.propertyUnits).toBe(100);
    expect(plan!.meetsCommitment).toBe(false);
  });
});

describe('AwardService.applyDesignations', () => {
  it('validates units against the property and rejects foreign units', async () => {
    // 1) get award (bound), 2) SELECT property unit ids
    mockQuery
      .mockResolvedValueOnce(qr([awardRow({ property_id: 'prop-1' })]))
      .mockResolvedValueOnce(qr([{ id: 'u1' }, { id: 'u2' }]));

    await expect(
      service.applyDesignations('award-1', [{ unitId: 'ghost', designation: '30' }], 'user-1'),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('writes designations transactionally and stamps acq.units_designated', async () => {
    // get award, SELECT unit ids
    mockQuery
      .mockResolvedValueOnce(qr([awardRow({ property_id: 'prop-1' })]))
      .mockResolvedValueOnce(qr([{ id: 'u1' }, { id: 'u2' }]));
    // transaction → applies 2 updates
    mockTransaction.mockImplementationOnce(async (fn: any) => {
      const client = { query: jest.fn().mockResolvedValue({ rowCount: 1 }) };
      return fn(client);
    });
    // designationPlan refresh after the write: get award, project mix, counts
    mockQuery
      .mockResolvedValueOnce(qr([awardRow({ property_id: 'prop-1' })]))
      .mockResolvedValueOnce(
        qr([
          {
            name: 'Desert Vista',
            total_units: 10,
            units_30_ami: 2,
            units_50_ami: 0,
            units_60_ami: 0,
            election_kind: 'STD_40_60',
          },
        ]),
      )
      .mockResolvedValueOnce(qr([{ ami_designation: '30', n: 2 }, { ami_designation: null, n: 8 }]));

    const result = await service.applyDesignations(
      'award-1',
      [
        { unitId: 'u1', designation: '30' },
        { unitId: 'u2', designation: '30' },
      ],
      'user-1',
    );
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(result!.updated).toBe(2);
    expect(result!.plan.meetsCommitment).toBe(true);
    expect(stamp).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'acq.units_designated' }),
    );
  });

  it('does not throw when the tape stamp fails (best-effort)', async () => {
    mockQuery
      .mockResolvedValueOnce(qr([awardRow({ property_id: 'prop-1' })]))
      .mockResolvedValueOnce(qr([{ id: 'u1' }]));
    mockTransaction.mockImplementationOnce(async (fn: any) => {
      const client = { query: jest.fn().mockResolvedValue({ rowCount: 1 }) };
      return fn(client);
    });
    mockQuery
      .mockResolvedValueOnce(qr([awardRow({ property_id: 'prop-1' })]))
      .mockResolvedValueOnce(
        qr([
          {
            name: 'X',
            total_units: 1,
            units_30_ami: 1,
            units_50_ami: 0,
            units_60_ami: 0,
            election_kind: 'STD_40_60',
          },
        ]),
      )
      .mockResolvedValueOnce(qr([{ ami_designation: '30', n: 1 }]));
    stamp.mockRejectedValueOnce(new Error('tape down'));

    const result = await service.applyDesignations(
      'award-1',
      [{ unitId: 'u1', designation: '30' }],
      'user-1',
    );
    expect(result!.updated).toBe(1);
  });
});

describe('BridgeError', () => {
  it('carries a machine code and optional detail', () => {
    const e = new BridgeError('VALIDATION', 'bad', [{ unitId: 'x', reason: 'y' }]);
    expect(e.code).toBe('VALIDATION');
    expect(e.detail).toEqual([{ unitId: 'x', reason: 'y' }]);
  });
});
