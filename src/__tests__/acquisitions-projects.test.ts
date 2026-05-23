/**
 * Service-layer tests for src/modules/acquisitions/project-service.ts.
 *
 * `query` is mocked. CRUD maps snake_case rows → camelCase; `score` fires the
 * project SELECT (1) then DemandService.getDemand's three queries (applicants,
 * waitlist, units), so score() sequences four mockResolvedValueOnce calls and
 * the scoring engine receives the folded qualified-demand total.
 */
import type { QueryResult } from 'pg';
import { ProjectService } from '../modules/acquisitions/project-service';
import { query } from '../config/database';

jest.mock('../config/database', () => ({ query: jest.fn() }));
jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

function qr<T extends Record<string, unknown>>(rows: T[], rowCount?: number): QueryResult<T> {
  return { rows, rowCount: rowCount ?? rows.length } as unknown as QueryResult<T>;
}

const mockQuery = query as jest.MockedFunction<typeof query>;

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'proj-1',
    name: 'Desert Vista',
    geographic_account: 'CLARK',
    city: 'Las Vegas',
    set_aside: 'NONPROFIT',
    election_kind: 'STD_20_50',
    total_units: 100,
    units_30_ami: 10,
    units_50_ami: 20,
    units_60_ami: 0,
    is_qct: true,
    is_dda: false,
    resident_services: ['case_management'],
    notes: null,
    created_by: 'user-1',
    created_at: '2026-05-22T00:00:00.000Z',
    updated_at: '2026-05-22T00:00:00.000Z',
    ...overrides,
  };
}

const service = new ProjectService();

beforeEach(() => mockQuery.mockReset());

describe('ProjectService CRUD', () => {
  it('list maps rows to camelCase projects', async () => {
    mockQuery.mockResolvedValueOnce(qr([row(), row({ id: 'proj-2', name: 'Pine Ridge' })]));
    const list = await service.list();
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({
      id: 'proj-1',
      name: 'Desert Vista',
      geographicAccount: 'CLARK',
      electionKind: 'STD_20_50',
      units30Ami: 10,
      isQct: true,
      residentServices: ['case_management'],
    });
  });

  it('get returns null when the row is missing', async () => {
    mockQuery.mockResolvedValueOnce(qr([]));
    expect(await service.get('nope')).toBeNull();
  });

  it('create passes mapped params in column order and returns the row', async () => {
    mockQuery.mockResolvedValueOnce(qr([row()]));
    const created = await service.create(
      {
        name: 'Desert Vista',
        geographicAccount: 'CLARK',
        city: 'Las Vegas',
        setAside: 'NONPROFIT',
        electionKind: 'STD_20_50',
        totalUnits: 100,
        units30Ami: 10,
        units50Ami: 20,
        units60Ami: 0,
        isQct: true,
        isDda: false,
        residentServices: ['case_management'],
        notes: null,
      },
      'user-1',
    );
    expect(created.id).toBe('proj-1');
    const [, params] = mockQuery.mock.calls[0];
    // $1 name … $12 resident_services (array) … $14 created_by
    expect(params).toEqual([
      'Desert Vista', 'CLARK', 'Las Vegas', 'NONPROFIT', 'STD_20_50',
      100, 10, 20, 0, true, false, ['case_management'], null, 'user-1',
    ]);
  });

  it('update returns null when no row matches', async () => {
    mockQuery.mockResolvedValueOnce(qr([]));
    const updated = await service.update('nope', {
      name: 'X', geographicAccount: 'WASHOE', electionKind: 'STD_40_60',
      totalUnits: 0, units30Ami: 0, units50Ami: 0, units60Ami: 0,
      isQct: false, isDda: false, residentServices: [],
    });
    expect(updated).toBeNull();
  });

  it('remove reports whether a row was deleted', async () => {
    mockQuery.mockResolvedValueOnce(qr([], 1));
    expect(await service.remove('proj-1')).toBe(true);
    mockQuery.mockResolvedValueOnce(qr([], 0));
    expect(await service.remove('gone')).toBe(false);
  });
});

describe('ProjectService.score', () => {
  it('returns null for a missing project', async () => {
    mockQuery.mockResolvedValueOnce(qr([])); // get → none
    expect(await service.score('nope')).toBeNull();
  });

  it('joins funnel demand into the scoring engine', async () => {
    // 1) project SELECT
    mockQuery.mockResolvedValueOnce(qr([row()]));
    // 2-4) DemandService.getDemand: applicants, waitlist, units.
    // CLARK has 60 qualified applicants across two cities.
    mockQuery
      .mockResolvedValueOnce(
        qr([
          { city: 'Las Vegas', bedrooms: 2, tier: '50', applicants: 40, is_qct: true, is_dda: false },
          { city: 'Henderson', bedrooms: 1, tier: '30', applicants: 20, is_qct: false, is_dda: false },
        ]),
      )
      .mockResolvedValueOnce(qr([{ city: 'Las Vegas', bedrooms: 2, depth: 5 }]))
      .mockResolvedValueOnce(qr([{ city: 'Las Vegas', bedrooms: 2, available: 3, total: 12 }]));

    const scored = await service.score('proj-1');
    expect(scored).not.toBeNull();
    expect(scored!.project.id).toBe('proj-1');

    // affordable units = 10 (@30) + 20 (@50) + 0 = 30; demand = 60 → 50% capture.
    expect(scored!.score.marketStudy.qualifiedDemand).toBe(60);
    expect(scored!.score.marketStudy.affordableUnits).toBe(30);
    expect(scored!.score.marketStudy.captureRatePct).toBe(50);
    expect(scored!.score.marketStudy.meetsThreshold).toBe(false); // 50% > 30%

    // 10% units ≤30% AMI → 6; STD_20_50 → 2; case_management → 2; QCT → 3 = 13.
    expect(scored!.score.funnelPoints).toBe(13);
  });
});
