/**
 * AUR Queue Service — over-income / Available Unit Rule queue (Lane 2).
 *
 * Reads recertifications where `income_ceiling_verdict` is `over_income_aur`
 * or `over_income`, joining the full context chain (property, unit,
 * designation) so staff can action the queue without a second round-trip.
 *
 * Property scope mirrors RecertificationService.list(): scoped roles are
 * filtered to their assigned property_ids (via buildPropertyScope); global
 * roles (system_admin, asset_manager, regional_manager) see everything.
 *
 * `aurThreshold` is computed in JS as `applicableLimit * 1.4` — the same
 * 140% Available Unit Rule factor that RecertComplianceService uses.
 */
import { query } from '../../config/database';
import { buildPropertyScope } from '../../middleware/scope';
import type { AuthRequest } from '../../middleware/auth';

/** The 140% Available Unit Rule factor (IRC §42(g)(2)(D)(ii)). */
const AUR_FACTOR = 1.4;

/** One entry in the over-income / AUR queue. */
export interface AurQueueEntry {
  recertId: string;
  tenantName: string;
  propertyName: string;
  unitNumber: string | null;
  /** AMI designation string e.g. "30" | "50" | "60" | "market" */
  designation: string | null;
  verdict: 'over_income_aur' | 'over_income';
  householdIncome: number | null;
  applicableLimit: number | null;
  /** applicableLimit * 1.4; null when applicableLimit is null */
  aurThreshold: number | null;
  /** r.nau_status from the parallel Lane-1 column (may be null). */
  nauStatus: string | null;
}

export interface AurQueueResult {
  queue: AurQueueEntry[];
  total: number;
}

export interface AurQueueFilters {
  propertyId?: string;
  limit?: number;
  offset?: number;
}

function num(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : parseFloat(v as string);
  return Number.isFinite(n) ? n : null;
}

interface AurRow {
  id: string;
  tenant_name: string;
  property_name: string;
  unit_number: string | null;
  ami_designation: string | null;
  income_ceiling_verdict: 'over_income_aur' | 'over_income';
  income_ceiling_income: string | number | null;
  income_ceiling_limit: string | number | null;
  nau_status: string | null;
}

export class AurQueueService {
  /**
   * List the over-income / AUR queue, respecting portfolio scope.
   *
   * Ordering: `over_income` (eviction-risk, worse) sorts before `over_income_aur`
   * (still in the 140% safe harbour), then by `income_ceiling_checked_at` ASC
   * so oldest reviews surface first.
   */
  async list(filters: AurQueueFilters, req: AuthRequest): Promise<AurQueueResult> {
    const conditions: string[] = [
      `r.income_ceiling_verdict IN ('over_income_aur', 'over_income')`,
    ];
    const params: unknown[] = [];

    if (filters.propertyId) {
      params.push(filters.propertyId);
      conditions.push(`r.property_id = $${params.length}`);
    }

    const scope = buildPropertyScope(req, params.length + 1, 'r.property_id');
    if (scope.denyAll) return { queue: [], total: 0 };
    if (scope.sql) {
      conditions.push(scope.sql);
      params.push(scope.param);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    // Count query (no joins needed beyond recertifications; all scope is on r.property_id).
    const countRes = await query(
      `SELECT COUNT(*) AS total FROM recertifications r ${where}`,
      params,
    );
    const total = parseInt((countRes.rows as Array<{ total: string }>)[0]?.total ?? '0', 10);

    if (total === 0) return { queue: [], total: 0 };

    // Data query: join to get the display fields.
    // nau_status is added by Lane 1; the column exists by deploy time — mocks
    // return it directly in tests so no real column resolution is needed here.
    const dataRes = await query(
      `SELECT
          r.id,
          r.tenant_name,
          p.name        AS property_name,
          u.unit_number,
          u.ami_designation,
          r.income_ceiling_verdict,
          r.income_ceiling_income,
          r.income_ceiling_limit,
          r.nau_status
        FROM recertifications r
        JOIN properties p ON r.property_id = p.id
        LEFT JOIN applications a ON r.application_id = a.id
        LEFT JOIN units u ON a.claimed_unit_id = u.id
       ${where}
       ORDER BY
         CASE r.income_ceiling_verdict
           WHEN 'over_income'     THEN 1
           WHEN 'over_income_aur' THEN 2
           ELSE 3
         END,
         r.income_ceiling_checked_at ASC NULLS LAST
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );

    const queue = (dataRes.rows as AurRow[]).map((row): AurQueueEntry => {
      const applicableLimit = num(row.income_ceiling_limit);
      const aurThreshold = applicableLimit !== null ? applicableLimit * AUR_FACTOR : null;
      return {
        recertId: row.id,
        tenantName: row.tenant_name,
        propertyName: row.property_name,
        unitNumber: row.unit_number ?? null,
        designation: row.ami_designation ?? null,
        verdict: row.income_ceiling_verdict,
        householdIncome: num(row.income_ceiling_income),
        applicableLimit,
        aurThreshold,
        nauStatus: row.nau_status ?? null,
      };
    });

    return { queue, total };
  }
}
