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
import { parkFailedStamp } from '../tape/dlq';
import type { TapeEvent } from '../tape/types';
import {
  evaluateRecertIncome,
  comparableUnit,
  recommendedRentAction,
  type AmiDesignation,
  type NauUnit,
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
  /** Bedrooms of the occupied unit — used for NAU comparability. */
  bedrooms: number | null;
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
  bedrooms: number | null;
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
              u.id AS unit_id, u.unit_number, u.ami_designation, u.bedrooms,
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
      bedrooms: row.bedrooms ?? null,
      amiArea: row.ami_area,
      householdSize,
      limitYear,
    };

    if (persist) await this.persist(recertId, designation, check);
    if (stamp) await this.stampSafe(context, check, opts.actorId ?? null);

    // QAP Phase 3.2: an over_income (>140%) verdict opens a Next Available Unit
    // obligation — the unit is out of compliance until a comparable available
    // unit is rented to a qualifying household. Only open it when persisting and
    // not already resolved; stamp the immutable record.
    if (persist && check.verdict === 'over_income') {
      await this.openNau(context, check, opts.actorId ?? null);
    }

    return { context, check };
  }

  /** Open a NAU obligation on the recert (idempotent — never reopens a
   *  satisfied/lost row) and stamp acq.nau_triggered. Best-effort on the tape. */
  private async openNau(
    context: RecertCheckContext,
    check: RecertIncomeCheck,
    actorId: string | null,
  ): Promise<void> {
    // Only set open when there is no terminal NAU state yet, so re-running the
    // check on an already-resolved over-income recert doesn't reopen it.
    await query(
      `UPDATE recertifications
          SET nau_status = 'open', updated_at = NOW()
        WHERE id = $1 AND nau_status IS NULL`,
      [context.recertId],
    );
    await this.stampNau('acq.nau_triggered', context, actorId, {
      verdict: check.verdict,
      ceilingAmiPct: check.ceilingAmiPct,
      applicableLimit: check.applicableLimit,
      aurThreshold: check.aurThreshold,
      householdIncome: check.householdIncome,
      designation: context.designation,
      bedrooms: context.bedrooms,
      note: check.note,
    });
  }

  /**
   * Satisfy a recert's open NAU obligation by crediting a comparable available
   * unit that has been rented to a qualifying household. Validates: the recert
   * is over_income with an open obligation, the resolving unit is comparable
   * (same property, ≥ bedrooms, equal-or-deeper tier), and the resolving unit is
   * actually occupied (rented). On success marks nau_status='satisfied' and
   * stamps acq.nau_satisfied. Throws a clear Error on any validation failure
   * (the route maps it to 400).
   *
   * @returns the updated check context.
   */
  async resolveNau(
    recertId: string,
    resolvingUnitId: string,
    actorId: string | null,
    notes: string,
  ): Promise<RecertCheckContext> {
    // Load the over-income recert + its occupied unit.
    const res = await query(
      `SELECT r.id, r.property_id, r.tenant_name, r.nau_status,
              r.income_ceiling_verdict,
              a.id AS application_id, a.household_size,
              u.id AS unit_id, u.unit_number, u.ami_designation, u.bedrooms,
              p.ami_area
         FROM recertifications r
         JOIN applications a ON r.application_id = a.id
         LEFT JOIN units u ON a.claimed_unit_id = u.id
         JOIN properties p ON r.property_id = p.id
        WHERE r.id = $1`,
      [recertId],
    );
    const row = (res.rows as (ResolveRow & {
      nau_status: string | null;
      income_ceiling_verdict: string | null;
    })[])[0];
    if (!row) throw new Error('Recertification not found');

    if (row.income_ceiling_verdict !== 'over_income') {
      throw new Error('Recertification has no over-income verdict — no NAU obligation to satisfy.');
    }
    if (row.nau_status !== 'open') {
      throw new Error(
        `NAU obligation is not open (current status: ${row.nau_status ?? 'none'}).`,
      );
    }
    if (!row.unit_id) {
      throw new Error('Recertification has no occupied unit — cannot evaluate NAU comparability.');
    }

    const overIncomeUnit: NauUnit = {
      propertyId: row.property_id,
      bedrooms: row.bedrooms ?? 0,
      amiDesignation: (row.ami_designation as AmiDesignation | null) ?? null,
    };

    // Load the candidate resolving unit.
    const candRes = await query(
      `SELECT id, property_id, unit_number, bedrooms, ami_designation, status, claimed_unit
         FROM (
           SELECT u.id, u.property_id, u.unit_number, u.bedrooms,
                  u.ami_designation, u.status,
                  (SELECT a2.id FROM applications a2
                    WHERE a2.claimed_unit_id = u.id LIMIT 1) AS claimed_unit
             FROM units u
            WHERE u.id = $1
         ) c`,
      [resolvingUnitId],
    );
    const cand = candRes.rows[0] as
      | {
          id: string;
          property_id: string;
          unit_number: string | null;
          bedrooms: number | null;
          ami_designation: string | null;
          status: string | null;
          claimed_unit: string | null;
        }
      | undefined;
    if (!cand) throw new Error('Resolving unit not found.');

    const candidateUnit: NauUnit = {
      propertyId: cand.property_id,
      bedrooms: cand.bedrooms ?? 0,
      amiDesignation: (cand.ami_designation as AmiDesignation | null) ?? null,
    };

    if (!comparableUnit(overIncomeUnit, candidateUnit)) {
      throw new Error(
        'Resolving unit is not comparable: must be in the same property, have at least as many bedrooms, and carry an equal-or-deeper AMI tier.',
      );
    }

    // The comparable unit must actually be rented to a qualifying household to
    // credit the set-aside: i.e. occupied (a household claims it) and not still
    // sitting available/held.
    const occupied = cand.claimed_unit !== null && cand.status !== 'available' && cand.status !== 'held';
    if (!occupied) {
      throw new Error(
        'Resolving unit must be rented to a qualifying household before it can satisfy the Next Available Unit Rule.',
      );
    }

    await query(
      `UPDATE recertifications
          SET nau_status = 'satisfied',
              nau_resolved_at = NOW(),
              nau_resolving_unit_id = $2,
              updated_at = NOW()
        WHERE id = $1 AND nau_status = 'open'`,
      [recertId, resolvingUnitId],
    );

    const context: RecertCheckContext = {
      recertId: row.id,
      applicationId: row.application_id,
      propertyId: row.property_id,
      tenantName: row.tenant_name,
      unitId: row.unit_id,
      unitNumber: row.unit_number,
      designation: (row.ami_designation as AmiDesignation | null) ?? null,
      bedrooms: row.bedrooms ?? null,
      amiArea: row.ami_area,
      householdSize: row.household_size && row.household_size > 0 ? row.household_size : 1,
      limitYear: null,
    };

    await this.stampNau('acq.nau_satisfied', context, actorId, {
      resolvingUnitId,
      resolvingUnitNumber: cand.unit_number,
      resolvingDesignation: cand.ami_designation,
      resolvingBedrooms: cand.bedrooms,
      designation: context.designation,
      bedrooms: context.bedrooms,
      notes,
    });

    return context;
  }

  /**
   * Mark an open NAU obligation **lost** (QAP Phase 3.2 — the inverse of
   * {@link resolveNau}). The Next Available Unit Rule is lost when the owner
   * fails to honour it: the next comparable available unit at the property is
   * rented to a *non-qualifying* household (consuming the slot), or the
   * obligation otherwise lapses. The over-income unit then stops counting
   * toward the set-aside and converts to market rent
   * (IRC §42(g)(2)(D)(ii)).
   *
   * Staff-attested (mirrors resolveNau's manual flow): the reviewer records
   * *why* the obligation was lost. If a `triggeringUnitId` is supplied it must
   * be a comparable unit that is actually rented (the slot that was consumed);
   * if omitted, the `reason` alone attests a lapse. On success sets
   * `nau_status='lost'`, applies `market_rent_applied_at` (the real
   * consequence), and stamps `acq.nau_lost`. Throws on any validation failure
   * (the route maps it to 400).
   *
   * @returns the resolved check context.
   */
  async markNauLost(
    recertId: string,
    triggeringUnitId: string | null,
    actorId: string | null,
    reason: string,
  ): Promise<RecertCheckContext> {
    // Load the over-income recert + its occupied unit (same shape as resolveNau).
    const res = await query(
      `SELECT r.id, r.property_id, r.tenant_name, r.nau_status,
              r.income_ceiling_verdict,
              a.id AS application_id, a.household_size,
              u.id AS unit_id, u.unit_number, u.ami_designation, u.bedrooms,
              p.ami_area
         FROM recertifications r
         JOIN applications a ON r.application_id = a.id
         LEFT JOIN units u ON a.claimed_unit_id = u.id
         JOIN properties p ON r.property_id = p.id
        WHERE r.id = $1`,
      [recertId],
    );
    const row = (res.rows as (ResolveRow & {
      nau_status: string | null;
      income_ceiling_verdict: string | null;
    })[])[0];
    if (!row) throw new Error('Recertification not found');

    if (row.income_ceiling_verdict !== 'over_income') {
      throw new Error('Recertification has no over-income verdict — no NAU obligation to lose.');
    }
    if (row.nau_status !== 'open') {
      throw new Error(
        `NAU obligation is not open (current status: ${row.nau_status ?? 'none'}).`,
      );
    }
    if (!row.unit_id) {
      throw new Error('Recertification has no occupied unit — cannot evaluate NAU comparability.');
    }

    // If a triggering unit is named, it must be the comparable slot that was
    // consumed: same property, ≥ bedrooms, equal-or-deeper tier, and actually
    // rented. (That it went to a *non-qualifying* household is what staff
    // attest via `reason` — the income of that household is not modelled here.)
    let triggeringUnitNumber: string | null = null;
    let triggeringDesignation: string | null = null;
    let triggeringBedrooms: number | null = null;
    if (triggeringUnitId) {
      const overIncomeUnit: NauUnit = {
        propertyId: row.property_id,
        bedrooms: row.bedrooms ?? 0,
        amiDesignation: (row.ami_designation as AmiDesignation | null) ?? null,
      };

      const candRes = await query(
        `SELECT id, property_id, unit_number, bedrooms, ami_designation, status, claimed_unit
           FROM (
             SELECT u.id, u.property_id, u.unit_number, u.bedrooms,
                    u.ami_designation, u.status,
                    (SELECT a2.id FROM applications a2
                      WHERE a2.claimed_unit_id = u.id LIMIT 1) AS claimed_unit
               FROM units u
              WHERE u.id = $1
           ) c`,
        [triggeringUnitId],
      );
      const cand = candRes.rows[0] as
        | {
            id: string;
            property_id: string;
            unit_number: string | null;
            bedrooms: number | null;
            ami_designation: string | null;
            status: string | null;
            claimed_unit: string | null;
          }
        | undefined;
      if (!cand) throw new Error('Triggering unit not found.');

      const candidateUnit: NauUnit = {
        propertyId: cand.property_id,
        bedrooms: cand.bedrooms ?? 0,
        amiDesignation: (cand.ami_designation as AmiDesignation | null) ?? null,
      };
      if (!comparableUnit(overIncomeUnit, candidateUnit)) {
        throw new Error(
          'Triggering unit is not comparable: must be in the same property, have at least as many bedrooms, and carry an equal-or-deeper AMI tier.',
        );
      }
      const occupied = cand.claimed_unit !== null && cand.status !== 'available' && cand.status !== 'held';
      if (!occupied) {
        throw new Error(
          'Triggering unit must be rented (the consumed slot) to lose the Next Available Unit obligation; an available/held unit means the obligation is still open.',
        );
      }
      triggeringUnitNumber = cand.unit_number;
      triggeringDesignation = cand.ami_designation;
      triggeringBedrooms = cand.bedrooms;
    }

    // Mark lost and apply the rent consequence (market_rent) atomically. The
    // partial UPDATE guard (nau_status='open') makes this idempotent under a
    // double-submit.
    await query(
      `UPDATE recertifications
          SET nau_status = 'lost',
              nau_resolved_at = NOW(),
              nau_resolving_unit_id = $2,
              market_rent_applied_at = COALESCE(market_rent_applied_at, NOW()),
              updated_at = NOW()
        WHERE id = $1 AND nau_status = 'open'`,
      [recertId, triggeringUnitId],
    );

    const context: RecertCheckContext = {
      recertId: row.id,
      applicationId: row.application_id,
      propertyId: row.property_id,
      tenantName: row.tenant_name,
      unitId: row.unit_id,
      unitNumber: row.unit_number,
      designation: (row.ami_designation as AmiDesignation | null) ?? null,
      bedrooms: row.bedrooms ?? null,
      amiArea: row.ami_area,
      householdSize: row.household_size && row.household_size > 0 ? row.household_size : 1,
      limitYear: null,
    };

    const rent = recommendedRentAction('over_income', { nauLost: true });
    await this.stampNau('acq.nau_lost', context, actorId, {
      triggeringUnitId,
      triggeringUnitNumber,
      triggeringDesignation,
      triggeringBedrooms,
      designation: context.designation,
      bedrooms: context.bedrooms,
      rentAction: rent.action,
      rentActionReason: rent.reason,
      reason,
    });

    return context;
  }

  /** Stamp a NAU tape event best-effort. subjectId MUST be null (global-scope
   *  admin event): compliance_tape.applicant_id is FK'd to users(id), so the
   *  recert/unit ids ride in evidence, never the scope key. */
  private async stampNau(
    kind: 'acq.nau_triggered' | 'acq.nau_satisfied' | 'acq.nau_lost',
    context: RecertCheckContext,
    actorId: string | null,
    evidence: Record<string, unknown>,
  ): Promise<void> {
    const event: TapeEvent = {
      kind,
      payload: {
        '@context': 'https://schema.org',
        '@type': 'AcquisitionComplianceEvent',
        actorId,
        subjectId: null, // global-scope: applicant_id is FK'd to users(id); ids live in evidence
        ruleCitation: 'IRC §42(g)(2)(D)(ii) (Next Available Unit Rule)',
        evidence: {
          recertId: context.recertId,
          propertyId: context.propertyId,
          unitId: context.unitId,
          unitNumber: context.unitNumber,
          ...evidence,
        },
      },
    };
    try {
      await tape.stamp(event);
    } catch (err) {
      // Swallow so a tape outage can't block a recert review, but park the failed
      // stamp so the NAU compliance record is recoverable, not silently lost.
      logger.error('acquisitions: NAU tape stamp failed (non-fatal)', {
        recertId: context.recertId,
        kind,
        err,
      });
      await parkFailedStamp(event, err as Error);
    }
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
    const event: TapeEvent = {
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
    };
    try {
      await tape.stamp(event);
    } catch (err) {
      // Swallow so a tape outage can't block a recert review, but park the failed
      // stamp so the income-check compliance record is recoverable, not lost.
      logger.error('acquisitions: recert income-check tape stamp failed (non-fatal)', {
        recertId: context.recertId,
        err,
      });
      await parkFailedStamp(event, err as Error);
    }
  }
}
