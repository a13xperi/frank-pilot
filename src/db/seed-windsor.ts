/**
 * Windsor Park identity seed — creates the Windsor Park property + its 93 units so
 * the unit-identity importer (import-windsor-identity.ts) can attach per-lot permits.
 *
 * Windsor is a single-parcel, for-sale subdivision (Frank document feed), not a LIHTC
 * rental community. Its lots are seeded here as IDENTITY-ONLY unit rows
 * (status 'identity_only', monthly_rent 0) so they populate the Truth-Unit registry
 * WITHOUT entering the rental funnel (which filters status='available'). The per-lot
 * permit number, lot number, and parcel link are applied afterward by
 * import-windsor-identity.ts; this seed only establishes the property + units keyed
 * by external_uid (WNDSR-###), the importer's match key.
 *
 * unit_number is set to the uid (WNDSR-###) rather than the situs address because
 * unit_number is VARCHAR(20) and some Windsor addresses (e.g. "#### HATTIE CANTY AVE")
 * exceed 20 chars.
 *
 * Idempotent: property guarded by exact name, units by (property_id, unit_number).
 * Source: src/db/data/windsor-lots.json (vendored from windsor.db).
 *
 *   npx tsx src/db/seed-windsor.ts   (then: npx tsx src/db/import-windsor-identity.ts)
 */
import dotenv from "dotenv";
dotenv.config();

import { readFileSync } from "fs";
import { join } from "path";
import { pool, query } from "../config/database";

// Must match WINDSOR_PROPERTY_NAME in import-windsor-identity.ts.
const PROPERTY_NAME = "Windsor Park";

interface WindsorLot {
  lot_no: number;
  permit: string;
  address: string;
  house_no: number;
  street: string;
  side: string;
  uid: string;
}

function loadLots(): WindsorLot[] {
  const raw = JSON.parse(readFileSync(join(__dirname, "data/windsor-lots.json"), "utf8"));
  return raw.lots as WindsorLot[];
}

async function run(): Promise<void> {
  const lots = loadLots();
  console.log(`Loaded ${lots.length} Windsor lots`);

  // 1. Property — guarded by exact name (the importer resolves the same way).
  let propertyId: string;
  const existing = await query(`SELECT id FROM properties WHERE name = $1 LIMIT 1`, [PROPERTY_NAME]);
  if (existing.rows.length > 0) {
    propertyId = existing.rows[0].id;
    console.log(`Property '${PROPERTY_NAME}' already present (${propertyId})`);
  } else {
    const ins = await query(
      `INSERT INTO properties (name, address_line1, city, state, zip, unit_count, ami_area, property_type)
       VALUES ($1, $2, $3, 'NV', $4, $5, $6, 'family') RETURNING id`,
      [PROPERTY_NAME, "Windsor Park subdivision", "North Las Vegas", "89030", lots.length, "Las Vegas"]
    );
    propertyId = ins.rows[0].id;
    console.log(`Inserted property '${PROPERTY_NAME}' (${propertyId})`);
  }

  // 2. Units — identity-only rows keyed by external_uid. bedrooms/monthly_rent are
  //    nominal (NOT NULL); status keeps them out of the available-units funnel.
  let inserted = 0;
  let present = 0;
  for (const lot of lots) {
    const r = await query(
      `INSERT INTO units (property_id, unit_number, bedrooms, monthly_rent, status, external_uid)
       VALUES ($1, $2, 3, 0, 'identity_only', $3)
       ON CONFLICT (property_id, unit_number) DO NOTHING
       RETURNING id`,
      [propertyId, lot.uid, lot.uid]
    );
    if (r.rows.length > 0) inserted++;
    else present++;
  }
  console.log(`Units: ${inserted} inserted, ${present} already present (${lots.length} lots)`);
  console.log(`Done. Next: npx tsx src/db/import-windsor-identity.ts`);
}

run()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("seed-windsor failed:", err);
    pool.end().finally(() => process.exit(1));
  });
