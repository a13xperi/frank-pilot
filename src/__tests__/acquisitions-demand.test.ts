/**
 * Service-layer tests for src/modules/acquisitions/demand-service.ts.
 *
 * `query` is mocked. getDemand fires three queries in array order
 * (applicants, waitlist, units) inside Promise.all, so mockResolvedValueOnce is
 * sequenced in that order. getDemandPacket calls getDemand (3) then the
 * QCT-coverage query (1) = 4 calls.
 *
 * Under test:
 *   - property-grain rows fold to the correct geographic account
 *   - cross-city totals aggregate (two Clark cities → one CLARK cell)
 *   - filters narrow the rollup
 *   - packet targeting mix / capture rate / basis-boost math
 */
import type { QueryResult } from 'pg';
import { DemandService } from '../modules/acquisitions/demand-service';
import { query } from '../config/database';

jest.mock('../config/database', () => ({ query: jest.fn() }));
jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

function qr<T extends Record<string, unknown>>(rows: T[]): QueryResult<T> {
  return { rows } as unknown as QueryResult<T>;
}

const mockQuery = query as jest.MockedFunction<typeof query>;

beforeEach(() => {
  mockQuery.mockReset();
});

describe('DemandService.getDemand', () => {
  it('folds property-grain rows to geographic accounts and aggregates cross-city', async () => {
    // Two Clark cities at 50% AMI, 2BR → one CLARK|2|50 cell of 12.
    mockQuery
      .mockResolvedValueOnce(
        qr([
          { city: 'Las Vegas', bedrooms: 2, tier: '50', applicants: 7, is_qct: true, is_dda: false },
          { city: 'Henderson', bedrooms: 2, tier: '50', applicants: 5, is_qct: false, is_dda: false },
          { city: 'Reno', bedrooms: 1, tier: '30', applicants: 4, is_qct: false, is_dda: false },
        ]),
      )
      .mockResolvedValueOnce(
        qr([
          { city: 'Las Vegas', bedrooms: 2, depth: 9 },
          { city: 'Reno', bedrooms: 1, depth: 3 },
        ]),
      )
      .mockResolvedValueOnce(
        qr([
          { city: 'Las Vegas', bedrooms: 2, available: 2, total: 10 },
          { city: 'Reno', bedrooms: 1, available: 1, total: 4 },
        ]),
      );

    const rollup = await new DemandService().getDemand();

    const clark2br50 = rollup.demand.find(
      (c) => c.account === 'CLARK' && c.bedrooms === 2 && c.tier === '50',
    );
    expect(clark2br50?.qualifiedApplicants).toBe(12);

    const washoe1br30 = rollup.demand.find((c) => c.account === 'WASHOE');
    expect(washoe1br30?.qualifiedApplicants).toBe(4);

    expect(rollup.totals.qualifiedApplicants).toBe(16);
    expect(rollup.totals.waitlistDepth).toBe(12);
    expect(rollup.totals.availableUnits).toBe(3);
    expect(rollup.totals.totalUnits).toBe(14);
  });

  it('skips rows with null bedrooms or non-AMI tiers', async () => {
    mockQuery
      .mockResolvedValueOnce(
        qr([
          { city: 'Las Vegas', bedrooms: null, tier: '50', applicants: 3, is_qct: false, is_dda: false },
          { city: 'Las Vegas', bedrooms: 2, tier: 'bogus', applicants: 9, is_qct: false, is_dda: false },
          { city: 'Las Vegas', bedrooms: 2, tier: '60', applicants: 4, is_qct: false, is_dda: false },
        ]),
      )
      .mockResolvedValueOnce(qr([]))
      .mockResolvedValueOnce(qr([]));

    const rollup = await new DemandService().getDemand();
    expect(rollup.totals.qualifiedApplicants).toBe(4);
    expect(rollup.demand).toHaveLength(1);
    expect(rollup.demand[0].tier).toBe('60');
  });

  it('applies account / bedroom / tier filters', async () => {
    mockQuery
      .mockResolvedValueOnce(
        qr([
          { city: 'Las Vegas', bedrooms: 2, tier: '50', applicants: 7, is_qct: false, is_dda: false },
          { city: 'Reno', bedrooms: 2, tier: '50', applicants: 5, is_qct: false, is_dda: false },
          { city: 'Las Vegas', bedrooms: 1, tier: '50', applicants: 2, is_qct: false, is_dda: false },
        ]),
      )
      .mockResolvedValueOnce(qr([]))
      .mockResolvedValueOnce(qr([]));

    const rollup = await new DemandService().getDemand({ account: 'CLARK', bedrooms: 2, tier: '50' });
    expect(rollup.demand).toHaveLength(1);
    expect(rollup.demand[0]).toMatchObject({ account: 'CLARK', bedrooms: 2, tier: '50', qualifiedApplicants: 7 });
  });
});

describe('DemandService.getDemandPacket', () => {
  it('computes targeting mix, capture rate, and basis-boost coverage', async () => {
    // getDemand's 3 queries (scoped to CLARK by the service filter):
    mockQuery
      .mockResolvedValueOnce(
        qr([
          { city: 'Las Vegas', bedrooms: 2, tier: '30', applicants: 25, is_qct: true, is_dda: false },
          { city: 'Las Vegas', bedrooms: 2, tier: '50', applicants: 25, is_qct: true, is_dda: false },
          { city: 'Las Vegas', bedrooms: 2, tier: '60', applicants: 50, is_qct: true, is_dda: false },
        ]),
      )
      .mockResolvedValueOnce(qr([{ city: 'Las Vegas', bedrooms: 2, depth: 30 }]))
      .mockResolvedValueOnce(qr([{ city: 'Las Vegas', bedrooms: 2, available: 20, total: 100 }]))
      // getQctCoverage:
      .mockResolvedValueOnce(
        qr([
          { city: 'Las Vegas', is_qct: true, is_dda: false },
          { city: 'Henderson', is_qct: false, is_dda: false },
          { city: 'Reno', is_qct: true, is_dda: false }, // WASHOE — excluded from CLARK packet
        ]),
      );

    const packet = await new DemandService().getDemandPacket('CLARK');

    expect(packet.account).toBe('CLARK');
    expect(packet.demand.qualifiedApplicants).toBe(100);
    // 30% tier = 25/100, 50% = 25/100 → deep demand share 50%.
    expect(packet.demand.deepDemandSharePct).toBe(50);

    const tier60 = packet.targetingMix.find((t) => t.tier === '60');
    expect(tier60?.sharePct).toBe(50);

    // capture = available(20) / demand(100) = 20% ≤ 30% ceiling → passes.
    expect(packet.marketStudy.captureRatePct).toBe(20);
    expect(packet.marketStudy.meetsCaptureThreshold).toBe(true);

    // 2 CLARK properties, 1 is QCT → basis-boost eligible.
    expect(packet.basisBoost.properties).toBe(2);
    expect(packet.basisBoost.qctOrDdaProperties).toBe(1);
    expect(packet.basisBoost.eligible).toBe(true);
    expect(packet.basisBoost.boostPct).toBe(30);
  });

  it('handles an empty submarket without dividing by zero', async () => {
    mockQuery
      .mockResolvedValueOnce(qr([]))
      .mockResolvedValueOnce(qr([]))
      .mockResolvedValueOnce(qr([]))
      .mockResolvedValueOnce(qr([]));

    const packet = await new DemandService().getDemandPacket('OTHER');
    expect(packet.demand.qualifiedApplicants).toBe(0);
    expect(packet.marketStudy.captureRatePct).toBeNull();
    expect(packet.marketStudy.meetsCaptureThreshold).toBe(false);
    expect(packet.basisBoost.eligible).toBe(false);
  });
});
