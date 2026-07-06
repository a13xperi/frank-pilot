/**
 * Occupancy / Form 8823 reporting (WS3, DM-FRANK-023-independent).
 *
 * Computes per-property occupancy as of a date and persists point-in-time
 * snapshots for the audit binder (e.g. the Luther Mack on-site LIHTC audit).
 *
 * Occupied = distinct units with an active onboarded tenancy whose lease covers
 * the as-of date (applications.claimed_unit_id, status='onboarded', lease window).
 * Total = properties.unit_count (the authoritative per-property unit total).
 */

import { query } from "../../config/database";
import { summarizeOccupancy, type OccupancySummary } from "./occupancy-math";

export interface PropertyOccupancy extends OccupancySummary {
  propertyId: string;
  propertyName: string;
  asOf: string; // YYYY-MM-DD
}

export interface OccupancySnapshotRecord extends PropertyOccupancy {
  id: string;
  computedBy: string | null;
  computedAt: string;
}

const dateOnly = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);

export class OccupancyService {
  /** Live occupancy for one property as of a date (no persistence). */
  async computeForProperty(propertyId: string, asOf: string): Promise<PropertyOccupancy | null> {
    const prop = await query(`SELECT id, name, unit_count FROM properties WHERE id = $1`, [propertyId]);
    if (prop.rows.length === 0) return null;
    const occ = await query(
      `SELECT COUNT(DISTINCT claimed_unit_id) AS occupied
       FROM applications
       WHERE property_id = $1 AND status = 'onboarded' AND claimed_unit_id IS NOT NULL
         AND (lease_start_date IS NULL OR lease_start_date <= $2)
         AND (lease_end_date IS NULL OR lease_end_date >= $2)`,
      [propertyId, asOf],
    );
    return this.assemble(prop.rows[0], Number(occ.rows[0]?.occupied ?? 0), asOf);
  }

  /** Live occupancy for every property as of a date. */
  async computeAll(asOf: string): Promise<PropertyOccupancy[]> {
    const props = await query(`SELECT id, name, unit_count FROM properties ORDER BY name ASC`);
    const occ = await query(
      `SELECT property_id, COUNT(DISTINCT claimed_unit_id) AS occupied
       FROM applications
       WHERE status = 'onboarded' AND claimed_unit_id IS NOT NULL
         AND (lease_start_date IS NULL OR lease_start_date <= $1)
         AND (lease_end_date IS NULL OR lease_end_date >= $1)
       GROUP BY property_id`,
      [asOf],
    );
    const occByProp = new Map<string, number>();
    for (const r of occ.rows as Array<{ property_id: string; occupied: string }>) {
      occByProp.set(r.property_id, Number(r.occupied));
    }
    return (prop_rows(props)).map((p) => this.assemble(p, occByProp.get(p.id) ?? 0, asOf));
  }

  /** Compute + persist a snapshot per property (idempotent upsert on (property, as_of)). */
  async snapshotAll(asOf: string, actorId: string): Promise<OccupancySnapshotRecord[]> {
    const live = await this.computeAll(asOf);
    const out: OccupancySnapshotRecord[] = [];
    for (const o of live) {
      const r = await query(
        `INSERT INTO occupancy_snapshots
           (property_id, as_of_date, total_units, occupied_units, vacant_units, occupancy_pct, computed_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (property_id, as_of_date) DO UPDATE SET
           total_units    = EXCLUDED.total_units,
           occupied_units = EXCLUDED.occupied_units,
           vacant_units   = EXCLUDED.vacant_units,
           occupancy_pct  = EXCLUDED.occupancy_pct,
           computed_by    = EXCLUDED.computed_by,
           computed_at    = NOW()
         RETURNING *`,
        [o.propertyId, asOf, o.totalUnits, o.occupiedUnits, o.vacantUnits, o.occupancyPct, actorId],
      );
      out.push(this.rowToSnapshot(r.rows[0], o.propertyName));
    }
    return out;
  }

  async listSnapshots(filters: { propertyId?: string; asOf?: string }): Promise<OccupancySnapshotRecord[]> {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (filters.propertyId) {
      params.push(filters.propertyId);
      conds.push(`s.property_id = $${params.length}`);
    }
    if (filters.asOf) {
      params.push(filters.asOf);
      conds.push(`s.as_of_date = $${params.length}`);
    }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const r = await query(
      `SELECT s.*, p.name AS property_name
       FROM occupancy_snapshots s JOIN properties p ON p.id = s.property_id
       ${where}
       ORDER BY s.as_of_date DESC, p.name ASC`,
      params,
    );
    return r.rows.map((row: Record<string, unknown>) => this.rowToSnapshot(row, row.property_name as string));
  }

  private assemble(propRow: Record<string, unknown>, occupied: number, asOf: string): PropertyOccupancy {
    const summary = summarizeOccupancy(Number(propRow.unit_count), occupied);
    return { propertyId: propRow.id as string, propertyName: propRow.name as string, asOf, ...summary };
  }

  private rowToSnapshot(row: Record<string, unknown>, propertyName: string): OccupancySnapshotRecord {
    return {
      id: row.id as string,
      propertyId: row.property_id as string,
      propertyName,
      asOf: dateOnly(row.as_of_date),
      totalUnits: Number(row.total_units),
      occupiedUnits: Number(row.occupied_units),
      vacantUnits: Number(row.vacant_units),
      occupancyPct: Number(row.occupancy_pct),
      computedBy: (row.computed_by as string | null) ?? null,
      computedAt: row.computed_at instanceof Date ? row.computed_at.toISOString() : String(row.computed_at),
    };
  }
}

/** Narrow the pg result rows to the property shape used above. */
function prop_rows(result: { rows: unknown[] }): Array<{ id: string; name: string; unit_count: number }> {
  return result.rows as Array<{ id: string; name: string; unit_count: number }>;
}
