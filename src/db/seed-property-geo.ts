/**
 * Full-unify seed: backfill property geocoordinates + synthesize statewide units.
 *
 * The statewide Nevada housing map originally shipped a hardcoded
 * `const PROPS = [...]` of 335 HUD-LIHTC communities WITH lat/lng inside
 * client-tenant/public/nv-housing-map.html. The `properties` DB table has the
 * catalog but NO coords and only 34 of ~323 rows carry units (so /discover
 * only shows 34 communities).
 *
 * The coordinate source-of-truth now lives at src/db/data/nv-housing-props.json
 * (committed alongside the backend so this seed never depends on the frontend
 * file, which has since been rewritten to fetch coords from the API at
 * runtime). If that JSON is missing we fall back to parsing the inline PROPS
 * array out of the map HTML when it's still present.
 *
 * This one-off, idempotent script makes the DB the single source of truth:
 *   1. Load the 335 map records (coords).
 *   2. For each map record, match an existing `properties` row by slug(name)
 *      (and/or normalized address); on match UPDATE its lat/lng. On miss,
 *      INSERT a new property (state=NV) with coords.
 *   3. For every property with ZERO units (skipping the original 34), generate
 *      a deterministic representative unit mix so /discover renders rents +
 *      availability statewide.
 *
 * Safe to re-run: coord updates are in place, inserts are guarded on slug, and
 * unit synthesis skips any property that already has units (so the original 34
 * real units are never touched).
 *
 *   ts-node src/db/seed-property-geo.ts
 */

import dotenv from "dotenv";
dotenv.config();

import { readFileSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import { pool, query } from "../config/database";

// ── slugify — byte-for-byte identical to the frontend (gpmg-fixtures.ts) and
// the backend slug resolution (regexp_replace(LOWER(name),'[^a-z0-9]+','-','g')
// then trim '-'). Reused everywhere so the map markers, /discover tiles and
// /property/:slug detail all agree.
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface MapProp {
  name: string;
  aka: string;
  city: string;
  address: string;
  lat: number;
  lng: number;
  totalUnits: number | null;
  restrictedUnits: number | null;
  type: "Family" | "Senior" | "Mixed";
  amiTiers: string[];
  funding: string[];
}

// ── Load the 335 map records (coords). Primary source is the committed JSON
// snapshot at src/db/data/nv-housing-props.json. If that's absent we fall back
// to parsing the inline `const PROPS = [ ... ];` JSON literal out of the map
// HTML (only present in the pre-API-rewrite version of the file).
function loadMapProps(): MapProp[] {
  const jsonPath = join(__dirname, "data/nv-housing-props.json");
  try {
    const raw = readFileSync(jsonPath, "utf8");
    return JSON.parse(raw) as MapProp[];
  } catch {
    // Fall through to the HTML parse below.
  }

  const htmlPath = join(__dirname, "../../client-tenant/public/nv-housing-map.html");
  const html = readFileSync(htmlPath, "utf8");
  const m = html.match(/const PROPS = (\[[\s\S]*?\]);/);
  if (!m) {
    throw new Error(
      "No coord source: src/db/data/nv-housing-props.json missing and no inline " +
        "`const PROPS = [...]` array in nv-housing-map.html"
    );
  }
  return JSON.parse(m[1]) as MapProp[];
}

// Map record type → DB property_type enum (senior | family | mixed_use).
function mapTypeToEnum(t: MapProp["type"]): "senior" | "family" | "mixed_use" {
  switch (t) {
    case "Senior":
      return "senior";
    case "Mixed":
      return "mixed_use";
    default:
      return "family";
  }
}

// Parse a map address ("811 Bridger Ave, NV 89101" / "Linden/Yori Street, NV
// 89502") into line1 + zip. The map record carries `city` separately, and
// state is always NV statewide. ZIP is the trailing 5-digit group when present.
function parseAddress(address: string): { line1: string; zip: string } {
  const zipMatch = address.match(/(\d{5})(?:-\d{4})?\s*$/);
  const zip = zipMatch ? zipMatch[1] : "";
  // Strip a trailing ", NV 89xxx" / " NV 89xxx" tail so line1 is just the street.
  const line1 = address
    .replace(/,?\s*NV\s*\d{5}(?:-\d{4})?\s*$/i, "")
    .replace(/,\s*$/, "")
    .trim();
  return { line1: line1 || address.trim(), zip };
}

// ── Deterministic unit synthesis ────────────────────────────────────────────
// Anchor rents to the canonical 60%-AMI figures the existing 34 seeded
// properties use (studio 747 / 1BR 995 / 2BR 1194 / 3BR 1380) so statewide
// inventory reads consistently. We spread a small ± band off the anchor keyed
// by a per-property hash so re-runs are stable but the catalog isn't a wall of
// identical numbers.
const BEDROOM_META: Record<
  number,
  { label: string; letter: string; floor: number; bathrooms: number; sqft: number; anchorRent: number }
> = {
  0: { label: "Studio", letter: "S", floor: 1, bathrooms: 1.0, sqft: 450, anchorRent: 747 },
  1: { label: "1BR", letter: "A", floor: 1, bathrooms: 1.0, sqft: 650, anchorRent: 995 },
  2: { label: "2BR", letter: "B", floor: 2, bathrooms: 1.5, sqft: 900, anchorRent: 1194 },
  3: { label: "3BR", letter: "C", floor: 3, bathrooms: 2.0, sqft: 1150, anchorRent: 1380 },
};

// Bedroom mix weights by community type. Senior → studios/1BR heavy; Family →
// 2/3BR heavy; Mixed → balanced. Weights are relative; we distribute the
// sample-unit count across them proportionally (deterministic rounding).
const MIX_WEIGHTS: Record<"senior" | "family" | "mixed_use", Record<number, number>> = {
  senior: { 0: 4, 1: 5, 2: 1, 3: 0 },
  family: { 0: 0, 1: 2, 2: 4, 3: 3 },
  mixed_use: { 0: 2, 1: 3, 2: 3, 3: 2 },
};

// Stable 0..1 from a string (property id + salt). FNV-ish via sha1 hex slice.
function hashUnit01(seed: string): number {
  const hex = createHash("sha1").update(seed).digest("hex").slice(0, 8);
  return parseInt(hex, 16) / 0xffffffff;
}

// Per-bedroom rent: anchor ± up to ~$60, deterministic on (propertyId,bedrooms).
function synthRent(propertyId: string, bedrooms: number): number {
  const anchor = BEDROOM_META[bedrooms].anchorRent;
  const band = 60;
  const r01 = hashUnit01(`${propertyId}:rent:${bedrooms}`);
  const delta = Math.round((r01 * 2 - 1) * band); // -band..+band
  return anchor + delta;
}

// Deterministic available/leased for a unit. ~25% available so `available_now`
// works statewide. Uses index so each property gets a stable spread.
function synthStatus(propertyId: string, idx: number): "available" | "leased" {
  // Bucket on a per-unit hash; <0.25 → available. Stable across re-runs.
  const r01 = hashUnit01(`${propertyId}:status:${idx}`);
  return r01 < 0.25 ? "available" : "leased";
}

// Distribute `total` sample units across bedrooms by integer weights,
// deterministically (largest-remainder), preserving the requested total.
function distributeMix(
  total: number,
  weights: Record<number, number>
): Record<number, number> {
  const beds = Object.keys(weights)
    .map(Number)
    .filter((b) => weights[b] > 0);
  const weightSum = beds.reduce((s, b) => s + weights[b], 0);
  if (weightSum === 0 || total === 0) return {};

  const raw = beds.map((b) => ({ b, exact: (total * weights[b]) / weightSum }));
  const floored = raw.map((r) => ({ b: r.b, n: Math.floor(r.exact), frac: r.exact - Math.floor(r.exact) }));
  let assigned = floored.reduce((s, r) => s + r.n, 0);
  // Hand out the remainder to the largest fractional parts (deterministic).
  const order = [...floored].sort((a, b) => b.frac - a.frac || a.b - b.b);
  let i = 0;
  while (assigned < total && order.length > 0) {
    order[i % order.length].n += 1;
    assigned += 1;
    i += 1;
  }
  const out: Record<number, number> = {};
  for (const r of floored) if (r.n > 0) out[r.b] = r.n;
  return out;
}

async function run(): Promise<void> {
  const props = loadMapProps();
  console.log(`Loaded ${props.length} map records (coord source)`);

  let coordsUpdated = 0;
  let inserted = 0;
  let matchedExisting = 0;

  for (const mp of props) {
    const slug = slugify(mp.name);
    const enumType = mapTypeToEnum(mp.type);
    const { line1, zip } = parseAddress(mp.address);
    const amiSetAside = mp.amiTiers && mp.amiTiers.length > 0 ? mp.amiTiers[0] : null;
    const lihtcType = mp.funding && mp.funding.length > 0 ? mp.funding.join(", ") : null;

    // Match an existing row by slug(name) using the same SQL slug derivation the
    // backend uses for /property/:slug resolution. (Address fallback is a no-op
    // here because slug match already covers the GPMG overlap; left explicit for
    // future maintainers.)
    const matchRes = await query(
      `SELECT id
         FROM properties
        WHERE trim(BOTH '-' FROM regexp_replace(LOWER(name), '[^a-z0-9]+', '-', 'g')) = $1
        LIMIT 1`,
      [slug]
    );

    if (matchRes.rows.length > 0) {
      const id = matchRes.rows[0].id;
      await query(
        `UPDATE properties SET latitude = $2, longitude = $3, updated_at = NOW() WHERE id = $1`,
        [id, mp.lat, mp.lng]
      );
      coordsUpdated++;
      matchedExisting++;
    } else {
      // INSERT a new statewide property. Guard on slug so re-runs never
      // duplicate: if a prior run already inserted it, the slug match above
      // would have hit. Belt-and-suspenders: re-check by exact name too.
      const existsByName = await query(`SELECT id FROM properties WHERE name = $1 LIMIT 1`, [
        mp.name,
      ]);
      if (existsByName.rows.length > 0) {
        await query(
          `UPDATE properties SET latitude = $2, longitude = $3, updated_at = NOW() WHERE id = $1`,
          [existsByName.rows[0].id, mp.lat, mp.lng]
        );
        coordsUpdated++;
        continue;
      }
      await query(
        `INSERT INTO properties
           (name, address_line1, city, state, zip, unit_count, ami_area,
            property_type, lihtc_type, ami_set_aside, latitude, longitude,
            waiting_list_enabled, total_vacancy, unit_mix, rent_schedule)
         VALUES ($1, $2, $3, 'NV', $4, $5, $6, $7, $8, $9, $10, $11, true, 0, '{}'::jsonb, '{}'::jsonb)`,
        [
          mp.name,
          line1,
          mp.city || "",
          zip,
          mp.totalUnits ?? 0,
          // ami_area is NOT NULL in the catalog; use city as a coarse area label.
          mp.city || "Nevada",
          enumType,
          lihtcType,
          amiSetAside,
          mp.lat,
          mp.lng,
        ]
      );
      inserted++;
    }
  }

  console.log(
    `Coords: ${coordsUpdated} updated (${matchedExisting} matched existing), ${inserted} new properties inserted`
  );

  // ── Synthesize units for properties with ZERO units ──────────────────────
  // Skip the existing 34 (they already have real units). For each remaining
  // property we generate up to min(unit_count, 24) sample units across a
  // type-weighted bedroom mix, deterministic on the property id.
  const zeroUnitProps = await query(
    `SELECT p.id, p.unit_count, p.property_type, p.ami_set_aside
       FROM properties p
       LEFT JOIN units u ON u.property_id = p.id
      WHERE u.id IS NULL
      ORDER BY p.name`
  );
  console.log(`Properties with zero units: ${zeroUnitProps.rows.length} (synthesizing)`);

  let unitsCreated = 0;
  let propsUnitised = 0;
  const SAMPLE_CAP = 24;

  for (const p of zeroUnitProps.rows) {
    const propertyId: string = p.id;
    const enumType = (p.property_type || "family") as "senior" | "family" | "mixed_use";
    const rawCount = Number(p.unit_count) || 0;
    // At least 4 sample units even for tiny / unknown counts so the card shows
    // a real mix; cap at SAMPLE_CAP so big communities don't bloat the table.
    const sampleCount = Math.max(4, Math.min(rawCount || SAMPLE_CAP, SAMPLE_CAP));
    const mix = distributeMix(sampleCount, MIX_WEIGHTS[enumType]);

    let idx = 0; // global per-property index for status spread
    for (const bedStr of Object.keys(mix)) {
      const bedrooms = Number(bedStr);
      const meta = BEDROOM_META[bedrooms];
      const n = mix[bedrooms];
      const rent = synthRent(propertyId, bedrooms);
      for (let i = 0; i < n; i++) {
        const seq = String(i + 1).padStart(2, "0");
        const unitNumber =
          meta.letter === "S"
            ? `S-${String(i + 1).padStart(3, "0")}`
            : `${meta.letter}-${meta.floor}${seq}`;
        const status = synthStatus(propertyId, idx);
        const availableFrom = status === "available" ? "CURRENT_DATE" : null;
        // Insert; ON CONFLICT keeps re-runs idempotent at the (property,unit)
        // grain even though the zero-unit guard already prevents re-entry.
        await query(
          `INSERT INTO units
             (property_id, unit_number, bedrooms, bathrooms, sqft, monthly_rent, status, available_from)
           VALUES ($1, $2, $3, $4, $5, $6, $7, ${availableFrom ? "CURRENT_DATE" : "NULL"})
           ON CONFLICT (property_id, unit_number) DO NOTHING`,
          [propertyId, unitNumber, bedrooms, meta.bathrooms, meta.sqft, rent, status]
        );
        unitsCreated++;
        idx++;
      }
    }
    propsUnitised++;
  }

  console.log(`Units: ${unitsCreated} synthesized across ${propsUnitised} properties`);

  // ── Summary ────────────────────────────────────────────────────────────
  const totals = await query(
    `SELECT
       (SELECT count(*) FROM properties) AS total_props,
       (SELECT count(*) FROM properties WHERE latitude IS NOT NULL AND longitude IS NOT NULL) AS with_coords,
       (SELECT count(DISTINCT property_id) FROM units) AS props_with_units,
       (SELECT count(*) FROM units) AS total_units`
  );
  const t = totals.rows[0];
  console.log(
    `\nDB now: ${t.total_props} properties · ${t.with_coords} with coords · ` +
      `${t.props_with_units} with units · ${t.total_units} unit rows`
  );
}

run()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("seed-property-geo failed:", err);
    pool.end().finally(() => process.exit(1));
  });
