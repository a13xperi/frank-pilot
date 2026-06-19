/**
 * Unit-identity Phase B — Windsor Park identity importer (WS-2).
 *
 * Standalone idempotent one-off (`ts-node src/db/import-windsor-identity.ts`). NOT
 * wired into seed.ts. Populates the per-unit identity layer (lot_number, the single
 * Windsor parcel, primary_permit_number, external_uid) and the unit_permits history
 * from the vendored windsor.db lots export in src/db/data/windsor-lots.json.
 *
 * Windsor is a single-parcel residential subdivision: lot == unit. One parcels row
 * (apn NULL, confirmed, ahj uniform = City of North Las Vegas), 93 lots each carrying
 * a building permit and a source uid (WNDSR-001..093).
 *
 * FAIL-CLOSED DISCIPLINE (mirrors seed-buildings.ts):
 *   - The Windsor property resolves ONLY by EXACT name equality. Absent → skip the
 *     whole import + warn (never create the property here; that's a seed concern).
 *   - Each lot matches an EXISTING units row by a strict priority chain — never
 *     creates units, never fuzzy-matches:
 *       1. external_uid == lot.uid   (once a lot has been linked, the uid is the key)
 *       2. unit_number == lot.address (full situs) OR unit_number == lot.house_no
 *     No match → skip that lot + log. On a fresh demo DB with no Windsor units this
 *     yields "0/93 lots linked" with per-lot warnings — a true no-op, not a silent one.
 *   - apn stays NULL (single residential parcel, no per-unit APN); never invented.
 */

import path from "path";
import { query as dbQuery } from "../config/database";
import { logger } from "../utils/logger";

// ── Types ────────────────────────────────────────────────────────────────────

/** One vendored Windsor lot (src/db/data/windsor-lots.json `lots`). */
export interface WindsorLot {
  lot_no: number;
  permit: string;
  address: string;
  house_no: number;
  street: string;
  side: string;
  uid: string;
}

/** Loose shape of the vendored windsor-lots.json file (only fields we read). */
interface WindsorLotsJson {
  lots: WindsorLot[];
  /** Uniform AHJ for the subdivision (City of North Las Vegas). */
  _ahj?: string;
  [k: string]: unknown;
}

// The Windsor Park property must already exist (resolved by EXACT name). This is the
// canonical name; if a seed lands it under a different string, update this constant.
const WINDSOR_PROPERTY_NAME = "Windsor Park";
const PERMIT_SOURCE = "windsor.db:2025";
const DEFAULT_AHJ = "North Las Vegas";

// ── Async importer (DB) ────────────────────────────────────────────────────────

type QueryFn = typeof dbQuery;

/** Resolve a units.id for one lot by the strict priority chain. Returns null (skip)
 * when no existing unit matches — never creates or fuzzy-matches. */
async function resolveUnitId(
  query: QueryFn,
  propertyId: string,
  lot: WindsorLot
): Promise<string | null> {
  // 1. external_uid == uid (authoritative once a prior run linked this lot).
  const byUid = await query(
    "SELECT id FROM units WHERE property_id = $1 AND external_uid = $2",
    [propertyId, lot.uid]
  );
  if (byUid.rows.length === 1) return (byUid.rows[0] as { id: string }).id;

  // 2. unit_number == address (full situs) OR == house_no. Match a single row only;
  //    >1 is ambiguous → skip (fail-closed).
  const byNumber = await query(
    "SELECT id FROM units WHERE property_id = $1 AND unit_number IN ($2, $3)",
    [propertyId, lot.address, String(lot.house_no)]
  );
  if (byNumber.rows.length === 1) return (byNumber.rows[0] as { id: string }).id;
  return null;
}

/**
 * Import Windsor unit identity + permits. Idempotent (per-unit UPDATE +
 * ON CONFLICT (unit_id, permit_number) DO NOTHING). Never throws on a missing
 * property/unit — logs and continues.
 */
export async function importWindsorIdentity(query: QueryFn = dbQuery): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const data = require(path.join(__dirname, "data", "windsor-lots.json")) as WindsorLotsJson;
  const lots = Array.isArray(data.lots) ? data.lots : [];
  const ahj = data._ahj || DEFAULT_AHJ;
  const totalLots = lots.length;

  // Resolve the Windsor property by EXACT name. Absent / ambiguous → skip everything.
  const propRow = await query("SELECT id FROM properties WHERE name = $1", [
    WINDSOR_PROPERTY_NAME,
  ]);
  if (propRow.rows.length === 0) {
    logger.warn(
      `importWindsorIdentity: no property row with name = '${WINDSOR_PROPERTY_NAME}' — ` +
        `nothing imported (seed the Windsor property first). 0/${totalLots} lots linked`
    );
    return;
  }
  if (propRow.rows.length > 1) {
    logger.warn(
      `importWindsorIdentity: ${propRow.rows.length} properties match name = ` +
        `'${WINDSOR_PROPERTY_NAME}' (ambiguous) — nothing imported. 0/${totalLots} lots linked`
    );
    return;
  }
  const propertyId = (propRow.rows[0] as { id: string }).id;

  // Single parcel for the whole subdivision: apn NULL, confirmed, uniform AHJ. A NULL
  // apn is exempt from the (property_id, apn) unique constraint, so re-running could
  // create duplicates — guard by selecting an existing NULL-apn parcel first.
  const existingParcel = await query(
    "SELECT id FROM parcels WHERE property_id = $1 AND apn IS NULL ORDER BY created_at LIMIT 1",
    [propertyId]
  );
  let parcelId: string;
  if (existingParcel.rows.length > 0) {
    parcelId = (existingParcel.rows[0] as { id: string }).id;
    await query(
      `UPDATE parcels SET ahj = $1, apn_confidence = 'confirmed', apn_source = $2, updated_at = NOW()
        WHERE id = $3`,
      [ahj, PERMIT_SOURCE, parcelId]
    );
  } else {
    const ins = await query(
      `INSERT INTO parcels (property_id, apn, ahj, apn_confidence, apn_source)
       VALUES ($1, NULL, $2, 'confirmed', $3)
       RETURNING id`,
      [propertyId, ahj, PERMIT_SOURCE]
    );
    parcelId = (ins.rows[0] as { id: string }).id;
  }

  let linked = 0;
  let skipped = 0;
  let permitsInserted = 0;

  for (const lot of lots) {
    const unitId = await resolveUnitId(query, propertyId, lot);
    if (!unitId) {
      skipped++;
      logger.warn(
        `importWindsorIdentity: lot ${lot.lot_no} (uid ${lot.uid}, '${lot.address}') — ` +
          `no existing unit matched by external_uid/unit_number; skipped (no unit created)`
      );
      continue;
    }

    // Set the unit's identity columns. lot_number stored as text per schema (VARCHAR).
    await query(
      `UPDATE units
          SET lot_number            = $1,
              primary_permit_number = $2,
              external_uid          = $3,
              parcel_id             = $4,
              updated_at            = NOW()
        WHERE id = $5`,
      [String(lot.lot_no), lot.permit, lot.uid, parcelId, unitId]
    );
    linked++;

    // Record the building permit in the per-unit permit history. Idempotent.
    const permIns = await query(
      `INSERT INTO unit_permits
         (unit_id, permit_number, permit_type, jurisdiction, permit_source)
       VALUES ($1, $2, 'building', $3, $4)
       ON CONFLICT (unit_id, permit_number) DO NOTHING`,
      [unitId, lot.permit, ahj, PERMIT_SOURCE]
    );
    permitsInserted += (permIns as { rowCount?: number | null }).rowCount ?? 0;
  }

  logger.info(
    `importWindsorIdentity: ${linked}/${totalLots} lots linked, ${skipped} skipped; ` +
      `1 parcel (apn NULL, ahj '${ahj}'); ${permitsInserted} new unit_permits inserted`
  );
}

// Run when invoked directly (ts-node src/db/import-windsor-identity.ts), not on import.
if (require.main === module) {
  importWindsorIdentity()
    .then(() => {
      logger.info("importWindsorIdentity: done");
      process.exit(0);
    })
    .catch((err) => {
      logger.error(
        `importWindsorIdentity: failed — ${err instanceof Error ? err.message : String(err)}`
      );
      process.exit(1);
    });
}
