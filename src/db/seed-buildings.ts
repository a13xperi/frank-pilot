/**
 * LIHTC §42 Phase A — buildings + BIN loader.
 *
 * Data layer only: transforms the reviewed GPMG BIN scan (src/db/data/bins.json)
 * into building rows keyed to a resolved property, and links seeded units to
 * their building where the unit-number happens to match. Changes NO compliance /
 * AUR / NAU enforcement logic.
 *
 * FAIL-CLOSED DISCIPLINE (wrong BIN on wrong property is a real §42 error):
 *   - Properties resolve ONLY by EXACT name equality on the bins.json `joinName`.
 *     No ILIKE / substring / fuzzy matching — 'Owens Senior' is a prefix of demo
 *     'Owens Senior Housing', 'Smith Williams Apts' vs 'Smith Williams Senior
 *     Apartments', etc. are DIFFERENT seeded rows.
 *   - The 5 binKeys with joinName=null (donnalouise, fletcher, mack, ocallaghan,
 *     srb) are SKIPPED + logged, never auto-attributed — even though demo twins
 *     exist by name and several unit counts line up. The source deliberately
 *     withheld a join key; await GPMG's authoritative list before mapping these.
 *   - NULL BINs stay NULL (5 of them); never invented.
 *   - fletcher's BIN mapping is PROVISIONAL (disputed handwritten annotations);
 *     its buildings carry bin_confidence='provisional'.
 *
 * NOTE on the property crosswalk: the resolvable joinName strings live verbatim
 * as `name` in nv-housing-props.json and are INSERTed by seed-property-geo.ts
 * (a manual one-off, NOT wired into npm scripts). A fresh `npm run seed` dev DB
 * has only the 17 demo rows and NONE of the joinName rows — so resolution yields
 * 0 rows and those properties are skipped-with-warning (never silently no-op).
 */

import path from "path";
import { query as dbQuery } from "../config/database";
import { logger } from "../utils/logger";

// ── Types ────────────────────────────────────────────────────────────────────

/** A building record derived from one bins.json building entry. */
export interface BuildingRecord {
  buildingCode: string;
  bin: string | null;
  binConfidence: "confirmed" | "provisional";
  unitCount: number;
  unitNumbers: string[];
}

/** All buildings for one bins.json property key. */
export interface PropertyBuildings {
  binKey: string;
  /** The GPMG join key, or null when the source withheld one (unmapped). */
  joinName: string | null;
  binSource: string | null;
  buildings: BuildingRecord[];
}

/** Raw shapes from bins.json (loose — only the fields we read). */
interface RawBuilding {
  buildingCode: string;
  bin: string | null;
  unitCount: number;
  units: string[];
}
interface RawProperty {
  propertyName: string | null;
  operatorEntity?: string;
  joinName: string | null;
  source: {
    type: string;
    date: string;
    [k: string]: unknown;
  };
  buildings: RawBuilding[];
  warnings?: string[];
}
export type BinsJson = Record<string, RawProperty>;

// binKeys whose BIN mapping is disputed / low-confidence (adversarial re-read).
const PROVISIONAL_KEYS = new Set<string>(["fletcher"]);

// ── Pure transform (test asserts against this — no DB) ────────────────────────

/**
 * Transform the raw bins.json into structured per-property building records.
 * Pure: no IO, no DB, no clock. NEVER invents a BIN; preserves NULLs as null.
 */
export function buildingsFromBins(binsJson: BinsJson): PropertyBuildings[] {
  const out: PropertyBuildings[] = [];

  for (const binKey of Object.keys(binsJson)) {
    const p = binsJson[binKey];
    const binConfidence: "confirmed" | "provisional" = PROVISIONAL_KEYS.has(binKey)
      ? "provisional"
      : "confirmed";

    // bin_source from source.type + date, e.g. 'gpmg-email:2026-05-27'.
    const binSource =
      p.source && p.source.type && p.source.date
        ? `${p.source.type}:${p.source.date}`
        : null;

    const buildings: BuildingRecord[] = p.buildings.map((b) => ({
      buildingCode: b.buildingCode,
      bin: b.bin, // preserve NULL — never invent
      binConfidence,
      unitCount: b.unitCount,
      unitNumbers: Array.isArray(b.units) ? b.units.slice() : [],
    }));

    out.push({
      binKey,
      joinName: p.joinName ?? null,
      binSource,
      buildings,
    });
  }

  return out;
}

// ── Async seeder (DB) ─────────────────────────────────────────────────────────

type QueryFn = typeof dbQuery;

/**
 * Seed building rows from bins.json and link matching seeded units.
 * Idempotent (ON CONFLICT upsert + per-unit UPDATE). Never throws on a missing
 * property — logs and continues. Fail-closed: resolves property by EXACT name.
 */
export async function seedBuildings(query: QueryFn = dbQuery): Promise<void> {
  // Load the source of truth at call time (not module-eval) so tests that mock
  // the DB don't pay the file read unless they exercise this path.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const binsJson = require(path.join(__dirname, "data", "bins.json")) as BinsJson;
  const records = buildingsFromBins(binsJson);

  let propsMapped = 0;
  let propsSkipped = 0;
  let buildingsUpserted = 0;
  let unitsMatched = 0;
  let unitsTotal = 0;

  for (const rec of records) {
    // Fail-closed: no joinName → unmapped, never auto-attribute.
    if (!rec.joinName) {
      propsSkipped++;
      logger.warn(
        `seedBuildings: skipping '${rec.binKey}' — no joinName in bins.json (unmapped; awaiting GPMG join key)`
      );
      continue;
    }

    // Resolve property by EXACT name equality only. No ILIKE / substring.
    const propRow = await query("SELECT id FROM properties WHERE name = $1", [rec.joinName]);
    if (propRow.rows.length === 0) {
      propsSkipped++;
      logger.warn(
        `seedBuildings: skipping '${rec.binKey}' — no property row with name = '${rec.joinName}' ` +
          `(run seed-property-geo.ts first; fresh demo DB lacks the statewide joinName rows)`
      );
      continue;
    }
    if (propRow.rows.length > 1) {
      // Multiple exact-name matches would make attachment ambiguous → fail-closed skip.
      propsSkipped++;
      logger.warn(
        `seedBuildings: skipping '${rec.binKey}' — ${propRow.rows.length} properties match name = '${rec.joinName}' (ambiguous)`
      );
      continue;
    }
    const propertyId = (propRow.rows[0] as { id: string }).id;
    propsMapped++;

    for (const b of rec.buildings) {
      const upsert = await query(
        `INSERT INTO buildings
           (property_id, building_code, bin, bin_confidence, bin_source, unit_count)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (property_id, building_code) DO UPDATE
           SET bin = EXCLUDED.bin,
               bin_confidence = EXCLUDED.bin_confidence,
               bin_source = EXCLUDED.bin_source,
               unit_count = EXCLUDED.unit_count,
               updated_at = NOW()
         RETURNING id`,
        [propertyId, b.buildingCode, b.bin, b.binConfidence, rec.binSource, b.unitCount]
      );
      const buildingId = (upsert.rows[0] as { id: string }).id;
      buildingsUpserted++;

      // Attach units by EXACT unit_number match. Unmatched → leave building_id
      // NULL (the bins unit-number scheme rarely overlaps seeded synthetic units).
      for (const unitNumber of b.unitNumbers) {
        unitsTotal++;
        const upd = await query(
          `UPDATE units SET building_id = $1, updated_at = NOW()
            WHERE property_id = $2 AND unit_number = $3`,
          [buildingId, propertyId, unitNumber]
        );
        const matched = (upd as { rowCount?: number | null }).rowCount ?? 0;
        if (matched > 0) unitsMatched++;
      }
    }
  }

  const coveragePct = unitsTotal > 0 ? ((unitsMatched / unitsTotal) * 100).toFixed(1) : "0.0";
  logger.info(
    `seedBuildings: ${propsMapped} properties mapped, ${propsSkipped} skipped; ` +
      `${buildingsUpserted} buildings upserted; ` +
      `unit coverage ${unitsMatched}/${unitsTotal} (${coveragePct}%) linked, rest left NULL`
  );
}
