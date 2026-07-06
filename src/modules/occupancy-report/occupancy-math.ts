/**
 * Occupancy math (pure, DB-free) — Form 8823 Exhibit C occupancy fields.
 *
 * Kept separate from the service so the arithmetic (clamping, rounding,
 * divide-by-zero) is unit-testable without a database.
 */

export interface OccupancySummary {
  totalUnits: number;
  occupiedUnits: number;
  vacantUnits: number;
  /** Occupancy percentage, 0..100, rounded to 2 decimals. */
  occupancyPct: number;
}

/** Derive occupied/vacant/percentage from raw counts. Clamped + rounded. */
export function summarizeOccupancy(totalUnits: number, occupiedUnits: number): OccupancySummary {
  const total = Math.max(0, Math.trunc(totalUnits));
  // Occupied can never exceed total — a stray claim must not push occupancy >100%.
  const occupied = Math.min(total, Math.max(0, Math.trunc(occupiedUnits)));
  const vacant = total - occupied;
  const pct = total === 0 ? 0 : Math.round((occupied / total) * 10000) / 100;
  return { totalUnits: total, occupiedUnits: occupied, vacantUnits: vacant, occupancyPct: pct };
}
