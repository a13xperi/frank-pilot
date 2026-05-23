/**
 * Candidate-project store + scoring orchestration (Phase 2).
 *
 * CRUD over acq_projects, plus `scoreProject` which joins the funnel's demand
 * (Demand-Evidence Engine, Phase 1) into the pure scoring engine (scoring.ts).
 * SQL lives here; the scoring math stays a pure function so it can be tested
 * without a database.
 */
import { query } from '../../config/database';
import { DemandService } from './demand-service';
import { scoreProject as runScore, type ScorableProject, type ProjectScore } from './scoring';
import type { GeographicAccount, SetAsideAccount, ElectionKind, ResidentService } from './qap-2026';

export interface ProjectInput {
  name: string;
  geographicAccount: GeographicAccount;
  city?: string | null;
  setAside?: SetAsideAccount | null;
  electionKind: ElectionKind;
  totalUnits: number;
  units30Ami: number;
  units50Ami: number;
  units60Ami: number;
  isQct: boolean;
  isDda: boolean;
  residentServices: ResidentService[];
  notes?: string | null;
}

export interface AcqProject extends ProjectInput {
  id: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScoredProject {
  project: AcqProject;
  score: ProjectScore;
}

interface ProjectRow {
  id: string;
  name: string;
  geographic_account: GeographicAccount;
  city: string | null;
  set_aside: SetAsideAccount | null;
  election_kind: ElectionKind;
  total_units: number;
  units_30_ami: number;
  units_50_ami: number;
  units_60_ami: number;
  is_qct: boolean;
  is_dda: boolean;
  resident_services: string[];
  notes: string | null;
  created_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function mapRow(r: ProjectRow): AcqProject {
  return {
    id: r.id,
    name: r.name,
    geographicAccount: r.geographic_account,
    city: r.city,
    setAside: r.set_aside,
    electionKind: r.election_kind,
    totalUnits: r.total_units,
    units30Ami: r.units_30_ami,
    units50Ami: r.units_50_ami,
    units60Ami: r.units_60_ami,
    isQct: r.is_qct,
    isDda: r.is_dda,
    residentServices: (r.resident_services ?? []) as ResidentService[],
    notes: r.notes,
    createdBy: r.created_by,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

/** The fields scoring reads — projected from a stored project. */
function toScorable(p: AcqProject): ScorableProject {
  return {
    geographicAccount: p.geographicAccount,
    electionKind: p.electionKind,
    totalUnits: p.totalUnits,
    units30Ami: p.units30Ami,
    units50Ami: p.units50Ami,
    units60Ami: p.units60Ami,
    isQct: p.isQct,
    isDda: p.isDda,
    residentServices: p.residentServices,
  };
}

export class ProjectService {
  private demand = new DemandService();

  async list(): Promise<AcqProject[]> {
    const res = await query(
      `SELECT * FROM acq_projects ORDER BY created_at DESC`,
    );
    return (res.rows as ProjectRow[]).map(mapRow);
  }

  async get(id: string): Promise<AcqProject | null> {
    const res = await query(`SELECT * FROM acq_projects WHERE id = $1`, [id]);
    const row = (res.rows as ProjectRow[])[0];
    return row ? mapRow(row) : null;
  }

  async create(input: ProjectInput, createdBy: string | null): Promise<AcqProject> {
    const res = await query(
      `INSERT INTO acq_projects
         (name, geographic_account, city, set_aside, election_kind,
          total_units, units_30_ami, units_50_ami, units_60_ami,
          is_qct, is_dda, resident_services, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        input.name,
        input.geographicAccount,
        input.city ?? null,
        input.setAside ?? null,
        input.electionKind,
        input.totalUnits,
        input.units30Ami,
        input.units50Ami,
        input.units60Ami,
        input.isQct,
        input.isDda,
        input.residentServices,
        input.notes ?? null,
        createdBy,
      ],
    );
    return mapRow((res.rows as ProjectRow[])[0]);
  }

  async update(id: string, input: ProjectInput): Promise<AcqProject | null> {
    const res = await query(
      `UPDATE acq_projects SET
         name = $2, geographic_account = $3, city = $4, set_aside = $5,
         election_kind = $6, total_units = $7, units_30_ami = $8,
         units_50_ami = $9, units_60_ami = $10, is_qct = $11, is_dda = $12,
         resident_services = $13, notes = $14, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        id,
        input.name,
        input.geographicAccount,
        input.city ?? null,
        input.setAside ?? null,
        input.electionKind,
        input.totalUnits,
        input.units30Ami,
        input.units50Ami,
        input.units60Ami,
        input.isQct,
        input.isDda,
        input.residentServices,
        input.notes ?? null,
      ],
    );
    const row = (res.rows as ProjectRow[])[0];
    return row ? mapRow(row) : null;
  }

  async remove(id: string): Promise<boolean> {
    const res = await query(`DELETE FROM acq_projects WHERE id = $1`, [id]);
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Score a stored project against the QAP subset, joining the current funnel
   * demand for the project's geographic account as the §6.1 market-study input.
   */
  async score(id: string): Promise<ScoredProject | null> {
    const project = await this.get(id);
    if (!project) return null;
    const rollup = await this.demand.getDemand({ account: project.geographicAccount });
    const score = runScore(toScorable(project), rollup.totals.qualifiedApplicants);
    return { project, score };
  }
}
