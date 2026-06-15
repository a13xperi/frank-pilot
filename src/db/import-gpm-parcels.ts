/**
 * Unit-identity Phase B — GPM parcel/APN importer (WS-2).
 *
 * Standalone idempotent one-off (`ts-node src/db/import-gpm-parcels.ts`). NOT
 * wired into seed.ts — run deliberately, like seed-property-geo.ts. Populates the
 * `parcels` APN layer (and links single-parcel sites' buildings) from the vendored
 * Clark Co. Assessor scan in src/db/data/gpm-parcels.json.
 *
 * FAIL-CLOSED DISCIPLINE (a wrong APN on the wrong property is a real identity error;
 * mirrors seed-buildings.ts):
 *   - Properties resolve ONLY by EXACT name equality on the row `name`. No ILIKE /
 *     substring / fuzzy matching. 0 matches OR >1 matches → skip + warn (never guess).
 *   - apn_confidence='provisional' rows carry the source's multi-parcel / "confirm" /
 *     "0 permits" disambiguation warning forward; they are upserted but never silently
 *     trusted (the parcels unique-on-confirmed-APN index exempts them).
 *   - buildings.parcel_id is linked ONLY when the property resolves to EXACTLY ONE
 *     parcel row (single-parcel site). Multi-parcel sites are left unlinked + logged —
 *     we never guess which building sits on which parcel.
 *   - NULLs are preserved; nothing is invented.
 *
 * The resolvable names live verbatim as `name` in the seed data. A fresh `npm run seed`
 * dev DB has only the demo rows and NONE of these statewide names, so resolution yields
 * 0 rows and every entry is skipped-with-warning (never a silent no-op) — run
 * seed-property-geo.ts first to land the statewide property rows.
 */

import path from "path";
import { query as dbQuery } from "../config/database";
import { logger } from "../utils/logger";

// ── Types ────────────────────────────────────────────────────────────────────

/** One vendored GPM parcel entry (src/db/data/gpm-parcels.json `rows`). */
export interface GpmParcelRow {
  id: string;
  name: string;
  apn: string;
  owner: string;
  units: number;
  ahj: string;
  tractGeoid: string | null;
  notes: string | null;
  apn_confidence: "confirmed" | "provisional";
}

/** Loose shape of the vendored gpm-parcels.json file (only fields we read). */
interface GpmParcelsJson {
  rows: GpmParcelRow[];
  [k: string]: unknown;
}

// apn_source is a single fixed provenance string for this vendored scan, mirroring
// seed-buildings' bin_source convention (e.g. 'gpmg-email:2026-05-27').
const APN_SOURCE = "clark-assessor:2026-06-03";

// ── Pure transform (no IO / DB / clock) ───────────────────────────────────────

/** Re-derive apn_confidence from notes, so the importer is correct even if the
 * vendored apn_confidence is missing/edited. A row is 'provisional' when its notes
 * carry a disambiguation / multi-parcel / "confirm" / "0 permits" warning. */
const PROVISIONAL_NOTE_RE =
  /confirm|multi-?parcel|separate parcel|0 permits|possibly 2|2 services|main building likely|3 separate parcels/i;

export function deriveApnConfidence(row: GpmParcelRow): "confirmed" | "provisional" {
  if (row.apn_confidence === "provisional") return "provisional";
  if (row.notes && PROVISIONAL_NOTE_RE.test(row.notes)) return "provisional";
  return "confirmed";
}

// ── Async importer (DB) ────────────────────────────────────────────────────────

type QueryFn = typeof dbQuery;

/**
 * Import GPM parcels and link single-parcel buildings. Idempotent
 * (ON CONFLICT (property_id, apn) DO UPDATE + per-building UPDATE). Never throws on
 * a missing/ambiguous property — logs and continues.
 */
export async function importGpmParcels(query: QueryFn = dbQuery): Promise<void> {
  // Load source of truth at call time (not module-eval) so a test that mocks the DB
  // doesn't pay the read unless it exercises this path.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const data = require(path.join(__dirname, "data", "gpm-parcels.json")) as GpmParcelsJson;
  const rows = Array.isArray(data.rows) ? data.rows : [];

  let propsResolved = 0;
  let propsSkipped = 0;
  let parcelsUpserted = 0;
  let provisionalParcels = 0;
  let buildingsLinked = 0;
  let sitesLinked = 0;
  let sitesMultiParcel = 0;
  const resolvedPropertyIds = new Set<string>();

  for (const row of rows) {
    // Resolve property by EXACT name equality only. No ILIKE / substring.
    const propRow = await query("SELECT id FROM properties WHERE name = $1", [row.name]);
    if (propRow.rows.length === 0) {
      propsSkipped++;
      logger.warn(
        `importGpmParcels: skipping '${row.id}' — no property row with name = '${row.name}' ` +
          `(run seed-property-geo.ts first; fresh demo DB lacks the statewide name rows)`
      );
      continue;
    }
    if (propRow.rows.length > 1) {
      propsSkipped++;
      logger.warn(
        `importGpmParcels: skipping '${row.id}' — ${propRow.rows.length} properties match name = '${row.name}' (ambiguous)`
      );
      continue;
    }
    const propertyId = (propRow.rows[0] as { id: string }).id;
    propsResolved++;
    resolvedPropertyIds.add(propertyId);

    const apnConfidence = deriveApnConfidence(row);
    if (apnConfidence === "provisional") provisionalParcels++;

    // Upsert exactly one parcel per entry. owner_of_record=owner, census_tract=tractGeoid.
    await query(
      `INSERT INTO parcels
         (property_id, apn, apn_county, owner_of_record, ahj, census_tract, apn_confidence, apn_source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (property_id, apn) DO UPDATE
         SET apn_county      = EXCLUDED.apn_county,
             owner_of_record = EXCLUDED.owner_of_record,
             ahj             = EXCLUDED.ahj,
             census_tract    = EXCLUDED.census_tract,
             apn_confidence  = EXCLUDED.apn_confidence,
             apn_source      = EXCLUDED.apn_source,
             updated_at      = NOW()`,
      [propertyId, row.apn, "Clark", row.owner, row.ahj, row.tractGeoid, apnConfidence, APN_SOURCE]
    );
    parcelsUpserted++;
  }

  // Second pass: link buildings → parcel ONLY for single-parcel sites. Counting in the
  // DB (not the input) keeps this fail-closed and idempotent: a site that already had a
  // second parcel from a prior run / other source stays unlinked. We never guess which
  // building sits on which parcel of a multi-parcel site.
  for (const propertyId of resolvedPropertyIds) {
    const parcelRows = await query(
      "SELECT id FROM parcels WHERE property_id = $1 ORDER BY apn",
      [propertyId]
    );
    if (parcelRows.rows.length !== 1) {
      sitesMultiParcel++;
      logger.warn(
        `importGpmParcels: property ${propertyId} has ${parcelRows.rows.length} parcels — ` +
          `leaving buildings.parcel_id unlinked (never guess which building sits on which parcel)`
      );
      continue;
    }
    const parcelId = (parcelRows.rows[0] as { id: string }).id;
    const upd = await query(
      `UPDATE buildings SET parcel_id = $1, updated_at = NOW()
        WHERE property_id = $2 AND parcel_id IS DISTINCT FROM $1`,
      [parcelId, propertyId]
    );
    const linked = (upd as { rowCount?: number | null }).rowCount ?? 0;
    if (linked > 0) buildingsLinked += linked;
    sitesLinked++;
  }

  logger.info(
    `importGpmParcels: ${propsResolved} properties resolved, ${propsSkipped} skipped; ` +
      `${parcelsUpserted} parcels upserted (${provisionalParcels} provisional); ` +
      `${sitesLinked} single-parcel sites linked (${buildingsLinked} buildings), ` +
      `${sitesMultiParcel} multi-parcel sites left unlinked`
  );
}

// Run when invoked directly (ts-node src/db/import-gpm-parcels.ts), not on import.
if (require.main === module) {
  importGpmParcels()
    .then(() => {
      logger.info("importGpmParcels: done");
      process.exit(0);
    })
    .catch((err) => {
      logger.error(`importGpmParcels: failed — ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });
}
