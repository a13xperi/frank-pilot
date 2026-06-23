/**
 * ════════════════════════════════════════════════════════════════════════════
 *  SAMPLE / TEST INVENTORY SEED  —  Donna Louise 1 + Donna Louise 2
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  ⚠️  THIS IS SAMPLE / TEST DATA. NOT a source of truth for real availability.
 *
 *  Purpose: give the unit-picker "platter" (the /discover → intent → claim-unit
 *  funnel, and the Donna Louise outbound-validation flow) real `available`
 *  inventory to match against in testing. The two Donna Louise properties are
 *  the demo-favourite family communities the outbound validator + tape tests
 *  already reference by slug (`donna-louise-1` / `donna-louise-2` — see
 *  src/modules/outbound-validation/dialer.ts and the *-routes test fixtures).
 *
 *  Real availability source is TBD and will come from the operator's system of
 *  record (OneSite / LOFT / the GPMGLV portal), NOT from this file. When that
 *  integration lands, these SAMPLE rows should be retired (or kept gated behind
 *  a demo/test DB only). The rents, unit numbers, sqft, and bath counts here are
 *  representative LIHTC 60%-AMI figures anchored to the canonical seed.ts values
 *  (1BR 995 / 2BR 1194 / 3BR 1380 / Studio 747) — they are illustrative, not the
 *  operator's actual rent roll.
 *
 *  What it seeds (idempotent — safe to re-run):
 *    • 2 properties:  "Donna Louise 1", "Donna Louise 2"
 *        - slug → donna-louise-1 / donna-louise-2 (matches the app's slug
 *          derivation: trim(BOTH '-' FROM regexp_replace(LOWER(name),
 *          '[^a-z0-9]+','-','g')) — the same SQL /property/:slug resolves on)
 *        - Las Vegas / North Las Vegas, NV  (city = "North Las Vegas")
 *        - ami_set_aside = "60% AMI", property_type = family
 *        - latitude / longitude set (SAMPLE coords near 6225 Donna St, NLV 89081)
 *    • A representative unit mix per property — a few each of Studio / 1BR / 2BR /
 *      3BR, ALL status 'available', ALL ami_designation '60', realistic
 *      affordable monthly_rent, available_from = today.
 *
 *  Idempotency: keyed on property `name` (the identity the rest of the seeders
 *  resolve on) + ON CONFLICT (property_id, unit_number) on the units. Re-running
 *  updates coords/ami_set_aside in place and never duplicates rows.
 *
 *  NOTE on naming: the production catalog seed (src/db/seed.ts) seeds these as
 *  "Donna Louise Apartments" / "Donna Louise Apartments 2"
 *  (→ donna-louise-apartments / donna-louise-apartments-2). This SAMPLE seed
 *  deliberately uses the SHORT names "Donna Louise 1" / "Donna Louise 2" so the
 *  slugs line up with the outbound-validation + test fixtures (donna-louise-1/2)
 *  that drive the platter in testing. Distinct names → distinct rows; this seed
 *  does not touch the production catalog rows.
 *
 *  Run:
 *    npx ts-node src/db/seed-sample-inventory.ts
 *  (reads DATABASE_URL or DB_* from .env via src/config/database — point it at
 *   your local/demo Postgres, NOT prod.)
 * ════════════════════════════════════════════════════════════════════════════
 */

import dotenv from "dotenv";
dotenv.config();

import { pool, query } from "../config/database";

// ── SAMPLE property records ──────────────────────────────────────────────────
// Las Vegas valley, NV. Coordinates are SAMPLE/approximate for 6225 Donna St,
// North Las Vegas 89081 (Donna Louise 1) with a small offset for the twin
// building (Donna Louise 2). Replace with surveyed coords / the real system of
// record (OneSite / LOFT / GPMGLV) when the live availability integration lands.
const AMI_AREA = "Las Vegas-Henderson-Paradise, NV MSA";
const AMI_SET_ASIDE = "60% AMI";
const MGR = "GPMG Property Management";

interface SampleProp {
  name: string;
  addressLine1: string;
  city: string;
  zip: string;
  phone: string;
  email: string;
  latitude: number;
  longitude: number;
  // Representative mix: a few each of Studio / 1BR / 2BR / 3BR.
  unitMix: Record<"Studio" | "1BR" | "2BR" | "3BR", number>;
}

const SAMPLE_PROPERTIES: SampleProp[] = [
  {
    name: "Donna Louise 1",
    addressLine1: "6225 Donna St",
    city: "North Las Vegas",
    zip: "89081",
    phone: "702-920-6548",
    email: "donnalouise@gpmglv.org",
    latitude: 36.2727, // SAMPLE — approx 6225 Donna St, North Las Vegas 89081
    longitude: -115.1287,
    unitMix: { Studio: 2, "1BR": 3, "2BR": 4, "3BR": 3 },
  },
  {
    name: "Donna Louise 2",
    addressLine1: "6225 Donna St",
    city: "North Las Vegas",
    zip: "89081",
    phone: "702-920-6548",
    email: "donnalouise@gpmglv.org",
    latitude: 36.2731, // SAMPLE — twin building, small offset from DL1
    longitude: -115.1281,
    unitMix: { Studio: 2, "1BR": 3, "2BR": 4, "3BR": 3 },
  },
];

// ── Bedroom metadata + canonical 60%-AMI sample rents ────────────────────────
// Anchored to the figures the production catalog seed (seed.ts) uses so SAMPLE
// inventory reads consistently with the rest of the catalog. SAMPLE only.
const BEDROOM_META: Record<
  "Studio" | "1BR" | "2BR" | "3BR",
  { letter: string; bedrooms: number; bathrooms: number; sqft: number; floor: number; rent: number }
> = {
  Studio: { letter: "S", bedrooms: 0, bathrooms: 1.0, sqft: 450, floor: 0, rent: 747 },
  "1BR": { letter: "A", bedrooms: 1, bathrooms: 1.0, sqft: 650, floor: 1, rent: 995 },
  "2BR": { letter: "B", bedrooms: 2, bathrooms: 1.5, sqft: 900, floor: 2, rent: 1194 },
  "3BR": { letter: "C", bedrooms: 3, bathrooms: 2.0, sqft: 1150, floor: 3, rent: 1380 },
};

// App-identical slug derivation (mirrors seed-property-geo.ts / gpmg-fixtures.ts
// and the backend /property/:slug SQL) — used only for the picsum photo seed.
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Insert mirrors the column list in seed.ts so a SAMPLE row is shaped exactly
// like a real catalog row. property_type is hardcoded 'family' (Donna Louise is
// a family community); waiting_list_enabled=false so units drive the picker.
const PROP_INSERT_SQL = `INSERT INTO properties
  (name, address_line1, city, state, zip, unit_count, ami_area,
   phone, email, property_manager, property_type,
   lihtc_type, ami_set_aside, compliance_period_start, compliance_period_end,
   has_lura, has_mortgage, jurisdiction,
   unit_mix, rent_schedule, total_vacancy, waiting_list_enabled,
   latitude, longitude)
  VALUES ($1,$2,$3,'NV',$4,$5,$6,$7,$8,$9,'family',$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,false,$20,$21)`;

async function run(): Promise<void> {
  console.log("Seeding SAMPLE inventory (Donna Louise 1 + 2)…");
  console.log("  ⚠️  SAMPLE/TEST data — real availability source TBD (OneSite/LOFT/GPMGLV).");

  let propsInserted = 0;
  let propsUpdated = 0;
  let unitsCreated = 0;

  for (const p of SAMPLE_PROPERTIES) {
    const unitCount = Object.values(p.unitMix).reduce((a, b) => a + b, 0);

    // Idempotent guard on name (same identity the catalog seeders resolve on).
    const existing = await query("SELECT id FROM properties WHERE name = $1 LIMIT 1", [p.name]);

    let propertyId: string;
    if (existing.rows.length > 0) {
      propertyId = existing.rows[0].id;
      // Re-run: keep the SAMPLE coords / set-aside fresh, don't duplicate.
      await query(
        `UPDATE properties
            SET ami_set_aside = $2, ami_area = $3, latitude = $4, longitude = $5,
                property_type = 'family', updated_at = NOW()
          WHERE id = $1`,
        [propertyId, AMI_SET_ASIDE, AMI_AREA, p.latitude, p.longitude]
      );
      propsUpdated++;
      console.log(`  Property exists, refreshed: ${p.name} (${propertyId})`);
    } else {
      const rentSchedule = {
        "Studio_60AMI": BEDROOM_META.Studio.rent,
        "1BR_60AMI": BEDROOM_META["1BR"].rent,
        "2BR_60AMI": BEDROOM_META["2BR"].rent,
        "3BR_60AMI": BEDROOM_META["3BR"].rent,
      };
      const res = await query(PROP_INSERT_SQL + " RETURNING id", [
        p.name, p.addressLine1, p.city, p.zip, unitCount, AMI_AREA,
        p.phone, p.email, MGR,
        "9% credit", AMI_SET_ASIDE, "2010-01-01", "2040-12-31",
        true, true, p.city,
        JSON.stringify(p.unitMix), JSON.stringify(rentSchedule),
        p.latitude, p.longitude,
      ]);
      propertyId = res.rows[0].id;
      propsInserted++;
      console.log(`  Property: ${p.name} → ${slugify(p.name)} (${unitCount} units, family) [${propertyId}]`);
    }

    // ── Units: a few each of Studio/1BR/2BR/3BR, all available, ami '60' ────
    const propSlug = slugify(p.name);
    for (const mixKey of Object.keys(p.unitMix) as Array<keyof typeof p.unitMix>) {
      const meta = BEDROOM_META[mixKey];
      const count = p.unitMix[mixKey];
      for (let i = 0; i < count; i++) {
        const seq = String(i + 1).padStart(2, "0");
        const unitNumber =
          meta.letter === "S"
            ? `S-${String(i + 1).padStart(3, "0")}`
            : `${meta.letter}-${meta.floor}${seq}`;
        const photoUrl = `https://picsum.photos/seed/${propSlug}-${unitNumber}/800/600`;

        // All SAMPLE units are status='available' and ami_designation='60' so the
        // platter always has 60%-AMI inventory to match in testing.
        const r = await query(
          `INSERT INTO units
             (property_id, unit_number, bedrooms, bathrooms, sqft, monthly_rent,
              status, ami_designation, photo_url, available_from)
           VALUES ($1, $2, $3, $4, $5, $6, 'available', '60', $7, CURRENT_DATE)
           ON CONFLICT (property_id, unit_number) DO NOTHING`,
          [propertyId, unitNumber, meta.bedrooms, meta.bathrooms, meta.sqft, meta.rent, photoUrl]
        );
        if (r.rowCount && r.rowCount > 0) unitsCreated++;
      }
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────
  const summary = await query(
    `SELECT p.name,
            trim(BOTH '-' FROM regexp_replace(LOWER(p.name), '[^a-z0-9]+', '-', 'g')) AS slug,
            p.ami_set_aside, p.latitude, p.longitude,
            count(u.id) FILTER (WHERE u.status = 'available') AS available_units,
            count(u.id) AS total_units
       FROM properties p
       LEFT JOIN units u ON u.property_id = p.id
      WHERE p.name IN ('Donna Louise 1', 'Donna Louise 2')
      GROUP BY p.name, p.ami_set_aside, p.latitude, p.longitude
      ORDER BY p.name`
  );
  console.log(
    `\nDone. ${propsInserted} inserted / ${propsUpdated} refreshed; ${unitsCreated} new units.`
  );
  for (const row of summary.rows) {
    console.log(
      `  • ${row.name} (${row.slug}) — set-aside ${row.ami_set_aside}, ` +
        `coords ${row.latitude},${row.longitude} — ` +
        `${row.available_units}/${row.total_units} units available`
    );
  }
}

run()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("seed-sample-inventory failed:", err);
    pool.end().finally(() => process.exit(1));
  });
