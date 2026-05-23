/**
 * Unit tests for src/modules/acquisitions/aur-queue-service.ts
 *
 * `query` is mocked — no real DB connection. Tests verify:
 *  1. Correct field mapping + aurThreshold computation.
 *  2. propertyId filter is forwarded to the SQL WHERE clause.
 *  3. Pagination limit/offset are appended as bind params.
 *  4. Empty result short-circuits after the COUNT query → { queue: [], total: 0 }.
 *  5. buildPropertyScope denyAll → immediate empty result (no query issued).
 */
import type { QueryResult } from 'pg';
import { AurQueueService } from '../modules/acquisitions/aur-queue-service';
import { query } from '../config/database';
import type { AuthRequest } from '../middleware/auth';

jest.mock('../config/database', () => ({ query: jest.fn() }));
jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

function qr<T extends Record<string, unknown>>(rows: T[]): QueryResult<T> {
  return { rows, rowCount: rows.length } as unknown as QueryResult<T>;
}

const mockQuery = query as jest.MockedFunction<typeof query>;

/** A global-scope staff request (no propertyIds constraint). */
function globalReq(overrides: Record<string, unknown> = {}): AuthRequest {
  return {
    user: { id: 'user-1', role: 'asset_manager', propertyIds: [], ...overrides },
  } as unknown as AuthRequest;
}

/** A scoped staff request with specific propertyIds. */
function scopedReq(propertyIds: string[]): AuthRequest {
  return {
    user: { id: 'user-2', role: 'leasing_agent', propertyIds },
  } as unknown as AuthRequest;
}

function aurRow(over: Record<string, unknown> = {}) {
  return {
    id: 'recert-1',
    tenant_name: 'Jane Doe',
    property_name: 'Sunset Gardens',
    unit_number: '204',
    ami_designation: '60',
    income_ceiling_verdict: 'over_income' as const,
    income_ceiling_income: '80000.00',
    income_ceiling_limit: '50000.00',
    nau_status: 'open',
    ...over,
  };
}

const svc = new AurQueueService();

beforeEach(() => {
  mockQuery.mockReset();
});

// ---------------------------------------------------------------------------
// 1. Field mapping + aurThreshold
// ---------------------------------------------------------------------------
describe('AurQueueService.list — field mapping', () => {
  it('maps db row to camelCase contract with computed aurThreshold', async () => {
    mockQuery
      .mockResolvedValueOnce(qr([{ total: '1' }])) // COUNT
      .mockResolvedValueOnce(qr([aurRow()]));       // data

    const result = await svc.list({}, globalReq());
    expect(result.total).toBe(1);
    expect(result.queue).toHaveLength(1);

    const entry = result.queue[0];
    expect(entry).toMatchObject({
      recertId: 'recert-1',
      tenantName: 'Jane Doe',
      propertyName: 'Sunset Gardens',
      unitNumber: '204',
      designation: '60',
      verdict: 'over_income',
      householdIncome: 80000,
      applicableLimit: 50000,
      aurThreshold: 70000,   // 50000 * 1.4
      nauStatus: 'open',
    });
  });

  it('computes aurThreshold for over_income_aur verdict', async () => {
    mockQuery
      .mockResolvedValueOnce(qr([{ total: '1' }]))
      .mockResolvedValueOnce(qr([aurRow({ income_ceiling_verdict: 'over_income_aur', income_ceiling_income: '60000.00', income_ceiling_limit: '50000.00' })]));

    const result = await svc.list({}, globalReq());
    const entry = result.queue[0];
    expect(entry.verdict).toBe('over_income_aur');
    expect(entry.aurThreshold).toBeCloseTo(70000);
  });

  it('returns null aurThreshold when applicableLimit is null', async () => {
    mockQuery
      .mockResolvedValueOnce(qr([{ total: '1' }]))
      .mockResolvedValueOnce(qr([aurRow({ income_ceiling_limit: null })]));

    const result = await svc.list({}, globalReq());
    expect(result.queue[0].applicableLimit).toBeNull();
    expect(result.queue[0].aurThreshold).toBeNull();
  });

  it('surfaces null nauStatus when r.nau_status is null', async () => {
    mockQuery
      .mockResolvedValueOnce(qr([{ total: '1' }]))
      .mockResolvedValueOnce(qr([aurRow({ nau_status: null })]));

    const result = await svc.list({}, globalReq());
    expect(result.queue[0].nauStatus).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. propertyId filter
// ---------------------------------------------------------------------------
describe('AurQueueService.list — propertyId filter', () => {
  it('includes the propertyId as a bind parameter in both queries', async () => {
    mockQuery
      .mockResolvedValueOnce(qr([{ total: '2' }]))
      .mockResolvedValueOnce(qr([aurRow(), aurRow({ id: 'recert-2' })]));

    await svc.list({ propertyId: 'prop-abc' }, globalReq());

    const countCall = mockQuery.mock.calls[0];
    const dataCall = mockQuery.mock.calls[1];

    // The propertyId UUID should appear as a bind param in both queries.
    expect(countCall[1]).toContain('prop-abc');
    expect(dataCall[1]).toContain('prop-abc');
  });
});

// ---------------------------------------------------------------------------
// 3. Pagination
// ---------------------------------------------------------------------------
describe('AurQueueService.list — pagination', () => {
  it('forwards limit and offset as trailing bind params to the data query', async () => {
    mockQuery
      .mockResolvedValueOnce(qr([{ total: '5' }]))
      .mockResolvedValueOnce(qr([aurRow()]));

    await svc.list({ limit: 10, offset: 20 }, globalReq());

    const dataParams = mockQuery.mock.calls[1][1] as unknown[];
    // limit and offset must be the last two params
    expect(dataParams[dataParams.length - 2]).toBe(10);
    expect(dataParams[dataParams.length - 1]).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// 4. Empty result
// ---------------------------------------------------------------------------
describe('AurQueueService.list — empty queue', () => {
  it('returns { queue: [], total: 0 } and does NOT issue a data query when COUNT is 0', async () => {
    mockQuery.mockResolvedValueOnce(qr([{ total: '0' }]));

    const result = await svc.list({}, globalReq());
    expect(result).toEqual({ queue: [], total: 0 });
    // Only the COUNT query should have fired.
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 5. Property scope — denyAll
// ---------------------------------------------------------------------------
describe('AurQueueService.list — property scope', () => {
  it('returns empty result immediately when a scoped role has no assigned properties (denyAll)', async () => {
    const result = await svc.list({}, scopedReq([]));
    expect(result).toEqual({ queue: [], total: 0 });
    // buildPropertyScope denyAll → must short-circuit; no DB call at all.
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('adds the property_ids array as a bind param for a scoped role', async () => {
    mockQuery
      .mockResolvedValueOnce(qr([{ total: '1' }]))
      .mockResolvedValueOnce(qr([aurRow()]));

    await svc.list({}, scopedReq(['prop-1', 'prop-2']));

    const countParams = mockQuery.mock.calls[0][1] as unknown[];
    // The property_ids array should be in the params.
    expect(countParams).toContainEqual(['prop-1', 'prop-2']);
  });
});
