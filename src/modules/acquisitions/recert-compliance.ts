/**
 * Recert income-ceiling enforcement (QAP acquisitions Phase 3.1).
 *
 * Bridges the Phase 3 designation layer to annual recertification: a household's
 * recertified income is measured against the income ceiling its occupied unit's
 * AMI designation enforces, applying the 140% Available Unit Rule
 * (IRC §42(g)(2)(D)(ii)). The math is pure (compliance-bridge.ts); this service
 * resolves the chain recertification → application → claimed unit → designation,
 * looks up the applicable HUD income limit (ami_limits), persists a verdict
 * snapshot on the recert, and stamps the immutable compliance tape.
 *
 * Read-only on the recert lifecycle: it never auto-adjusts rent or changes the
 * reviewer's pass/fail decision — it surfaces a verdict the reviewer acts on.
 */
import { query } from '../../config/database';
import { logger } from '../../utils/logger';
import { createTapeService } from '../tape/service';
import { PgTapeRepository } from '../tape/repository';
import {
  evaluateRecertIncome,
  type AmiDesignation,
  type RecertIncomeCheck,
} from './compliance-bridge';

const tape = createTapeService(new PgTapeRepository());

/** The resolved context behind a check, returned alongside the verdict so the
 *  reviewer/API can see what the income was measured against. */
export interface RecertCheckContext {
  recertId: string;
  applicationId: string;
  propertyId: string;
  tenantName: string;
  unitId: string | null;
  unitNumber: string | null;
  designation: AmiDesignation | null;
  amiArea: string | null;
  householdSize: number;
  /** Calendar year the income limit was drawn from (current or prior fallback). */
  limitYear: number | null;
}

export interface RecertComplianceResult {
  context: RecertCheckContext;
  check: RecertIncomeCheck;
}

interface ResolveRow {
  id: string;
  property_id: string;
  tenant_name: string;
  new_annual_income: string | null;
  previous_annual_income: string | null;
  application_id: string;
  claimed_unit_id: string | null;
  household_size: number | null;
  application_income: string | null;
  unit_id: string | null;
  unit_number: string | null;
  ami_designation: string | null;
  ami_area: string | null;
}

interface AmiLimitRow {
  ami_30_percent: string | null;
  ami_50_percent: string | null;
  ami_60_percent: string | null;
}

function num(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

export class RecertComplianceService {
  /**
   * Evaluate a recertification's income against its unit's AMI ceiling.
   *
   * @param recertId  the recertification to check.
   * @param opts.income   override income to measure (e.g. a freshly submitted
   *                      figure not yet persisted); otherwise the recert's
   *                      recertified → previous → application income is used.
   * @param opts.persist  write the verdict snapshot onto the recert (default true).
   * @param opts.stamp    stamp the compliance tape (default true).
   * @param opts.actorId  actor for the tape stamp.
   * @returns the verdict + resolved context, or null if the recert is unknown.
   */
  async check(
    recertId: string,
    opts: {
      income?: number | null;
      persist?: boolean;
      stamp?: boolean;
      actorId?: string | null;
    } = {},
  ): Promise<RecertComplianceResult | null> {
    const persist = opts.persist ?? true;
    const stamp = opts.stamp ?? true;

    const res = await query(
      `SELECT r.id, r.property_id, r.tenant_name,
              r.new_annual_income, r.previous_annual_income,
              a.id AS application_id, a.claimed_unit_id,
              a.household_size, a.annual_income AS application_income,
              u.id AS unit_id, u.unit_number, u.ami_designation,
              p.ami_area
         FROM recertifications r
         JOIN applications a ON r.application_id = a.id
         LEFT JOIN units u ON a.claimed_unit_id = u.id
         JOIN properties p ON r.property_id = p.id
        WHERE r.id = $1`,
      [recertId],
    );
    const row = (res.rows as ResolveRow[])[0];
    if (!row) return null;

    const householdSize = row.household_size && row.household_size > 0 ? row.household_size : 1;
    const designation = (row.ami_designation as AmiDesignation | null) ?? null;

    // Income to measure: explicit override → recertified → previous → application.
    const income =
      opts.income ??
      num(row.new_annual_income) ??
      num(row.previous_annual_income) ??
      num(row.application_income);

    // Resolve the applicable HUD income limit for the designation tier, only
    // when the unit is restricted (market/undesignated need no limit).
    let applicableLimit: number | null = null;
    let limitYear: number | null = null;
    if (designation && designation !== 'market' && row.ami_area) {
      const resolved = await this.resolveLimit(row.ami_area, householdSize, designation);
      applicableLimit = resolved.limit;
      limitYear = resolved.year;
    }

    const check = evaluateRecertIncome({ designation, applicableLimit, householdIncome: income });

    const context: RecertCheckContext = {
      recertId: row.id,
      applicationId: row.application_id,
      propertyId: row.property_id,
      tenantName: row.tenant_name,
      unitId: row.unit_id,
      unitNumber: row.unit_number,
      designation,
      amiArea: row.ami_area,
      householdSize,
      limitYear,
    };

    if (persist) await this.persist(recertId, designation, check);
    if (stamp) await this.stampSafe(context, check, opts.actorId ?? null);

    return { context, check };
  }

  /** Look up the income limit for a tier + household size, falling back to the
   *  prior calendar year (mirrors the screening ComplianceService behaviour). */
  private async resolveLimit(
    amiArea: string,
    householdSize: number,
    designation: Exclude<AmiDesignation, 'market'>,
  ): Promise<{ limit: number | null; year: number | null }> {
    const column = `ami_${designation}_percent` as keyof AmiLimitRow;
    const thisYear = new Date().getFullYear();

    for (const year of [thisYear, thisYear - 1]) {
      const res = await query(
        `SELECT ami_30_percent, ami_50_percent, ami_60_percent
           FROM ami_limits
          WHERE area = $1 AND year = $2 AND household_size = $3`,
        [amiArea, year, householdSize],
      );
      const limit = num((res.rows as AmiLimitRow[])[0]?.[column]);
      if (limit !== null) return { limit, year };
    }
    return { limit: null, year: null };
  }

  /** Snapshot the verdict on the recert so the review UI/API can show it without
   *  recomputing. The tape is the immutable record; this is a convenience cache. */
  private async persist(
    recertId: string,
    designation: AmiDesignation | null,
    check: RecertIncomeCheck,
  ): Promise<void> {
    await query(
      `UPDATE recertifications
          SET income_ceiling_verdict = $2,
              income_ceiling_designation = $3,
              income_ceiling_limit = $4,
              income_ceiling_income = $5,
              income_ceiling_checked_at = NOW(),
              updated_at = NOW()
        WHERE id = $1`,
      [
        recertId,
        check.verdict,
        designation,
        check.applicableLimit,
        check.householdIncome,
      ],
    );
  }

  /** Stamp best-effort: a tape failure must not block a recert review. Subject
   *  is the recert id so the entry reads under that recert's scope. */
  private async stampSafe(
    context: RecertCheckContext,
    check: RecertIncomeCheck,
    actorId: string | null,
  ): Promise<void> {
    try {
      await tape.stamp({
        kind: 'acq.recert_income_checked',
        payload: {
          '@context': 'https://schema.org',
          '@type': 'AcquisitionComplianceEvent',
          actorId,
          subjectId: null, // global-scope admin event — subjectId is FK'd to users(id); the recert id lives in evidence
          ruleCitation: 'IRC §42(g)(2)(D)(ii) (Available Unit Rule) + 26 CFR 1.42-5',
          evidence: {
            recertId: context.recertId,
            propertyId: context.propertyId,
            unitId: context.unitId,
            unitNumber: context.unitNumber,
            designation: context.designation,
            amiArea: context.amiArea,
            householdSize: context.householdSize,
            limitYear: context.limitYear,
            verdict: check.verdict,
            ceilingAmiPct: check.ceilingAmiPct,
            applicableLimit: check.applicableLimit,
            aurThreshold: check.aurThreshold,
            householdIncome: check.householdIncome,
            pctOfLimit: check.pctOfLimit,
            note: check.note,
          },
        },
      });
    } catch (err) {
      logger.error('acquisitions: recert income-check tape stamp failed (non-fatal)', {
        recertId: context.recertId,
        err,
      });
    }
  }
}
