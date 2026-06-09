/**
 * Award store + designation orchestration (Phase 3 — Compliance Bridge).
 *
 * CRUD over acq_awards, binding an award to a managed property, and the
 * designation flow: turn the won project's committed unit mix into per-unit
 * AMI designations on the bound property's units, recording each step on the
 * append-only compliance tape. The designation math is a pure function
 * (compliance-bridge.ts); SQL and the tape stamp live here.
 */
import { query, transaction } from '../../config/database';
import { logger } from '../../utils/logger';
import { createTapeService } from '../tape/service';
import { PgTapeRepository } from '../tape/repository';
import { parkFailedStamp } from '../tape/dlq';
import type { TapeEvent } from '../tape/types';
import {
  buildDesignationPlan,
  validateAssignments,
  type AmiDesignation,
  type CommittedMix,
  type DesignationPlan,
  type DesignationTargets,
} from './compliance-bridge';
import type { ElectionKind } from './qap-2026';

export type AwardStatus = 'reserved' | 'placed_in_service' | 'in_service' | 'closed';
export const AWARD_STATUSES: AwardStatus[] = ['reserved', 'placed_in_service', 'in_service', 'closed'];

export interface AwardInput {
  acqProjectId: string;
  propertyId?: string | null;
  status?: AwardStatus;
  reservationAmount?: number | null;
  awardDate?: string | null;
  placedInServiceDeadline?: string | null;
  notes?: string | null;
}

export interface AcqAward {
  id: string;
  acqProjectId: string;
  propertyId: string | null;
  status: AwardStatus;
  reservationAmount: number | null;
  awardDate: string | null;
  placedInServiceDeadline: string | null;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A bound property's unit, with its current AMI designation. */
export interface BoundUnit {
  id: string;
  unitNumber: string;
  bedrooms: number;
  amiDesignation: AmiDesignation | null;
}

/** Typed service error so routes can map to the right HTTP status. */
export class BridgeError extends Error {
  constructor(
    public code: 'NOT_FOUND' | 'NOT_BOUND' | 'VALIDATION' | 'CONFLICT',
    message: string,
    public detail?: unknown,
  ) {
    super(message);
    this.name = 'BridgeError';
  }
}

interface AwardRow {
  id: string;
  acq_project_id: string;
  property_id: string | null;
  status: AwardStatus;
  reservation_amount: string | number | null;
  award_date: Date | string | null;
  placed_in_service_deadline: Date | string | null;
  notes: string | null;
  created_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function asDateString(v: Date | string | null): string | null {
  if (v == null) return null;
  // DATE columns come back as 'YYYY-MM-DD' strings already; normalize Dates too.
  return typeof v === 'string' ? v.slice(0, 10) : v.toISOString().slice(0, 10);
}

function mapRow(r: AwardRow): AcqAward {
  return {
    id: r.id,
    acqProjectId: r.acq_project_id,
    propertyId: r.property_id,
    status: r.status,
    reservationAmount: r.reservation_amount == null ? null : Number(r.reservation_amount),
    awardDate: asDateString(r.award_date),
    placedInServiceDeadline: asDateString(r.placed_in_service_deadline),
    notes: r.notes,
    createdBy: r.created_by,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

/** The project mix needed to drive designations, read from acq_projects. */
interface ProjectMixRow {
  total_units: number;
  units_30_ami: number;
  units_50_ami: number;
  units_60_ami: number;
  election_kind: ElectionKind;
  name: string;
}

const tape = createTapeService(new PgTapeRepository());

/** Stamp the compliance tape best-effort: a tape failure must not lose a
 *  durable units.ami_designation write (the management-side truth). */
async function stampSafe(
  kind: 'acq.award_recorded' | 'acq.units_designated',
  actorId: string | null,
  evidence: Record<string, unknown>,
): Promise<void> {
  const event: TapeEvent = {
    kind,
    payload: {
      '@context': 'https://schema.org',
      '@type': 'AcquisitionComplianceEvent',
      actorId,
      subjectId: null, // global-scope admin event
      ruleCitation: kind === 'acq.award_recorded' ? 'IRC §42 + NV 2026 QAP §3' : 'IRC §42(g) + 26 CFR 1.42-5',
      evidence,
    },
  };
  try {
    await tape.stamp(event);
  } catch (err) {
    // Swallow so a tape outage can't lose a durable units.ami_designation write,
    // but park the failed stamp so the compliance record is recoverable, not lost.
    logger.error('acquisitions: compliance-tape stamp failed (non-fatal)', { kind, err });
    await parkFailedStamp(event, err as Error);
  }
}

export class AwardService {
  async list(): Promise<AcqAward[]> {
    const res = await query(`SELECT * FROM acq_awards ORDER BY created_at DESC`);
    return (res.rows as AwardRow[]).map(mapRow);
  }

  async get(id: string): Promise<AcqAward | null> {
    const res = await query(`SELECT * FROM acq_awards WHERE id = $1`, [id]);
    const row = (res.rows as AwardRow[])[0];
    return row ? mapRow(row) : null;
  }

  /** Record that a scored project won a reservation. Stamps the tape. */
  async create(input: AwardInput, createdBy: string | null): Promise<AcqAward> {
    try {
      const res = await query(
        `INSERT INTO acq_awards
           (acq_project_id, property_id, status, reservation_amount,
            award_date, placed_in_service_deadline, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING *`,
        [
          input.acqProjectId,
          input.propertyId ?? null,
          input.status ?? 'reserved',
          input.reservationAmount ?? null,
          input.awardDate ?? null,
          input.placedInServiceDeadline ?? null,
          input.notes ?? null,
          createdBy,
        ],
      );
      const award = mapRow((res.rows as AwardRow[])[0]);
      await stampSafe('acq.award_recorded', createdBy, {
        awardId: award.id,
        acqProjectId: award.acqProjectId,
        propertyId: award.propertyId,
        reservationAmount: award.reservationAmount,
        awardDate: award.awardDate,
      });
      return award;
    } catch (err) {
      const pg = err as { code?: string };
      if (pg.code === '23505') {
        throw new BridgeError('CONFLICT', 'This project already has an award.');
      }
      if (pg.code === '23503') {
        throw new BridgeError('VALIDATION', 'Unknown project or property reference.');
      }
      throw err;
    }
  }

  /** Update mutable award fields (status, dates, amount, notes, binding). */
  async update(id: string, input: Partial<AwardInput>): Promise<AcqAward | null> {
    const existing = await this.get(id);
    if (!existing) return null;
    const merged: AcqAward = {
      ...existing,
      propertyId: input.propertyId === undefined ? existing.propertyId : input.propertyId,
      status: input.status ?? existing.status,
      reservationAmount:
        input.reservationAmount === undefined ? existing.reservationAmount : input.reservationAmount,
      awardDate: input.awardDate === undefined ? existing.awardDate : input.awardDate,
      placedInServiceDeadline:
        input.placedInServiceDeadline === undefined
          ? existing.placedInServiceDeadline
          : input.placedInServiceDeadline,
      notes: input.notes === undefined ? existing.notes : input.notes,
    };
    try {
      const res = await query(
        `UPDATE acq_awards SET
           property_id = $2, status = $3, reservation_amount = $4,
           award_date = $5, placed_in_service_deadline = $6, notes = $7,
           updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [
          id,
          merged.propertyId,
          merged.status,
          merged.reservationAmount,
          merged.awardDate,
          merged.placedInServiceDeadline,
          merged.notes,
        ],
      );
      const row = (res.rows as AwardRow[])[0];
      return row ? mapRow(row) : null;
    } catch (err) {
      const pg = err as { code?: string };
      if (pg.code === '23503') {
        throw new BridgeError('VALIDATION', 'Unknown property reference.');
      }
      throw err;
    }
  }

  async remove(id: string): Promise<boolean> {
    const res = await query(`DELETE FROM acq_awards WHERE id = $1`, [id]);
    return (res.rowCount ?? 0) > 0;
  }

  /** Read the won project's committed mix for an award. */
  private async projectMix(acqProjectId: string): Promise<(CommittedMix & { name: string }) | null> {
    const res = await query(
      `SELECT name, total_units, units_30_ami, units_50_ami, units_60_ami, election_kind
         FROM acq_projects WHERE id = $1`,
      [acqProjectId],
    );
    const row = (res.rows as ProjectMixRow[])[0];
    if (!row) return null;
    return {
      name: row.name,
      totalUnits: row.total_units,
      units30Ami: row.units_30_ami,
      units50Ami: row.units_50_ami,
      units60Ami: row.units_60_ami,
      electionKind: row.election_kind,
    };
  }

  /** Current designation counts + total units on a bound property. */
  private async propertyDesignationState(
    propertyId: string,
  ): Promise<{ counts: DesignationTargets; total: number }> {
    const res = await query(
      `SELECT ami_designation, COUNT(*)::int AS n
         FROM units WHERE property_id = $1
         GROUP BY ami_designation`,
      [propertyId],
    );
    const counts: DesignationTargets = { '30': 0, '50': 0, '60': 0, market: 0 };
    let total = 0;
    for (const row of res.rows as Array<{ ami_designation: AmiDesignation | null; n: number }>) {
      total += row.n;
      if (row.ami_designation && row.ami_designation in counts) {
        counts[row.ami_designation] += row.n;
      }
    }
    return { counts, total };
  }

  /**
   * The bound property's units with their current AMI designation, for the
   * assignment grid. Throws NOT_BOUND if no property is bound.
   */
  async listBoundUnits(id: string): Promise<BoundUnit[]> {
    const award = await this.get(id);
    if (!award) throw new BridgeError('NOT_FOUND', 'Award not found.');
    if (!award.propertyId) {
      throw new BridgeError('NOT_BOUND', 'Award is not bound to a property yet.');
    }
    const res = await query(
      `SELECT id, unit_number, bedrooms, ami_designation
         FROM units WHERE property_id = $1
         ORDER BY unit_number`,
      [award.propertyId],
    );
    return (res.rows as Array<{
      id: string;
      unit_number: string;
      bedrooms: number;
      ami_designation: AmiDesignation | null;
    }>).map((r) => ({
      id: r.id,
      unitNumber: r.unit_number,
      bedrooms: r.bedrooms,
      amiDesignation: r.ami_designation,
    }));
  }

  /**
   * Build the designation plan for an award: committed mix vs the bound
   * property's current designations. Throws NOT_BOUND if no property is bound.
   */
  async designationPlan(id: string): Promise<DesignationPlan | null> {
    const award = await this.get(id);
    if (!award) return null;
    if (!award.propertyId) {
      throw new BridgeError('NOT_BOUND', 'Award is not bound to a property yet.');
    }
    const mix = await this.projectMix(award.acqProjectId);
    if (!mix) throw new BridgeError('NOT_FOUND', 'Award references a missing project.');
    const { counts, total } = await this.propertyDesignationState(award.propertyId);
    return buildDesignationPlan(mix, counts, total);
  }

  /**
   * Apply a { unitId → designation } assignment to the bound property's units,
   * atomically, then stamp the tape. Returns the refreshed plan.
   */
  async applyDesignations(
    id: string,
    assignments: ReadonlyArray<{ unitId: string; designation: AmiDesignation }>,
    actorId: string | null,
  ): Promise<{ updated: number; plan: DesignationPlan } | null> {
    const award = await this.get(id);
    if (!award) return null;
    if (!award.propertyId) {
      throw new BridgeError('NOT_BOUND', 'Award is not bound to a property yet.');
    }

    // Validate against the units that actually belong to the bound property.
    const unitRes = await query(`SELECT id FROM units WHERE property_id = $1`, [award.propertyId]);
    const propertyUnitIds = new Set((unitRes.rows as Array<{ id: string }>).map((r) => r.id));
    const errors = validateAssignments(assignments, propertyUnitIds);
    if (errors.length > 0) {
      throw new BridgeError('VALIDATION', 'Invalid unit assignments.', errors);
    }

    const updated = await transaction(async (client) => {
      let n = 0;
      for (const { unitId, designation } of assignments) {
        const r = await client.query(
          `UPDATE units SET ami_designation = $2, updated_at = NOW()
             WHERE id = $1 AND property_id = $3`,
          [unitId, designation, award.propertyId],
        );
        n += r.rowCount ?? 0;
      }
      return n;
    });

    const plan = await this.designationPlan(id);
    await stampSafe('acq.units_designated', actorId, {
      awardId: award.id,
      propertyId: award.propertyId,
      unitsDesignated: updated,
      committedRestricted: plan?.committedRestricted ?? null,
      assignedRestricted: plan?.assignedRestricted ?? null,
      meetsCommitment: plan?.meetsCommitment ?? null,
    });
    return { updated, plan: plan as DesignationPlan };
  }

  /** Compliance rollup: the designation plan plus the award's status. */
  async compliance(id: string): Promise<{ award: AcqAward; plan: DesignationPlan } | null> {
    const award = await this.get(id);
    if (!award) return null;
    const plan = await this.designationPlan(id);
    return { award, plan: plan as DesignationPlan };
  }
}
