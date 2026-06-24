/**
 * onboard-property.ts — idempotently add or update ONE property (+ its units)
 * from a canonical JSON input file, WITHOUT the destructive full reseed.
 *
 * Why this exists: `seed.ts` wipes-then-reseeds (demo/e2e only) and is unusable
 * against the shared prod DB; `seed-property-geo.ts` proved the safe pattern
 * (slug-match -> UPDATE-in-place else INSERT; units ON CONFLICT DO NOTHING) but
 * only for the synthetic statewide backfill. Onboarding a real new building
 * (Donna Louise 2, then the ~15 GPMG buildings after it) needs a single,
 * additive, re-runnable entrypoint. This is it.
 *
 * It does ONE thing: the frank-pilot (Railway) properties + units rows. It does
 * NOT touch Sage (waitlist/QR live there with their own tooling), does NOT flip
 * flags, and does NOT dial. LIHTC buildings/BIN rows go through the existing
 * fail-closed seed-buildings.ts once GPMG provides an authoritative BIN.
 *
 * Safety rails:
 *   - Input with `_status` containing DRAFT/PENDING -> ABORTS, so a building
 *     whose facts aren't confirmed by GPM can't be seeded with placeholders.
 *   - unit_mix must sum to unit_count -> else ABORTS (no silent mix drift).
 *   - Property match by the SAME slug derivation the backend uses for
 *     /property/:slug, so map + /discover + detail all agree.
 *   - Additive only: UPDATE in place or INSERT; never DELETE, never wipe.
 *   - Prints a field-level diff of every change.
 *
 *   ts-node src/db/onboard-property.ts src/db/data/onboard/<building>.json
 *
 * Operator-run against Railway prod (this is DML to the shared multi-tenant DB).
 */

import dotenv from "dotenv";
dotenv.config();

import { readFileSync } from "fs";
import { resolve } from "path";
import { pool, query } from "../config/database";

// Byte-for-byte identical to seed-property-geo.ts / the backend slug resolution.
function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// bedrooms -> unit-number scheme + defaults, mirroring seed-property-geo BEDROOM_META.
const BEDROOM_META: Record<
  number,
  { label: string; letter: string; floor: number; bathrooms: number; sqft: number; anchorRent: number }
> = {
  0: { label: "Studio", letter: "S", floor: 1, bathrooms: 1.0, sqft: 450, anchorRent: 747 },
  1: { label: "1BR", letter: "A", floor: 1, bathrooms: 1.0, sqft: 650, anchorRent: 995 },
  2: { label: "2BR", letter: "B", floor: 2, bathrooms: 1.5, sqft: 900, anchorRent: 1194 },
  3: { label: "3BR", letter: "C", floor: 3, bathrooms: 2.0, sqft: 1150, anchorRent: 1380 },
};
const LABEL_TO_BEDROOMS: Record<string, number> = {
  studio: 0, "0br": 0, "1br": 1, "2br": 2, "3br": 3,
};

interface OnboardInput {
  _status?: string;
  name: string;
  address_line1: string;
  address_line2?: string | null;
  city: string;
  state?: string;
  zip: string;
  unit_count: number;
  ami_area?: string;
  phone?: string | null;
  email?: string | null;
  property_manager?: string | null;
  property_type?: "family" | "senior" | "mixed_use";
  lihtc_type?: string | null;
  ami_set_aside?: string | null;
  jurisdiction?: string | null;
  census_tract?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  waiting_list_enabled?: boolean;
  total_vacancy?: number;
  unit_mix?: Record<string, number>; // {"1BR":12,"2BR":24,...}
  rent_schedule?: Record<string, number>; // {"1BR_60AMI":995,...} or {"1BR":995}
  unit_status?: "available" | "leased";
  ami_designation?: "30" | "50" | "60" | "market" | null;
  // Optional per-tier breakdown (keys like "1BR_45AMI", "2BR_market"). When
  // present, units are generated at each tier's own rent + designation instead
  // of the coarse unit_mix-at-first-tier fallback. Must reconcile to unit_mix.
  _ami_breakdown?: Record<string, { units: number; income_cap?: number | null; rent: number }>;
}

function loadInput(): OnboardInput {
  const p = process.argv[2];
  if (!p) {
    console.error("usage: ts-node src/db/onboard-property.ts <input.json>");
    process.exit(2);
  }
  return JSON.parse(readFileSync(resolve(p), "utf8")) as OnboardInput;
}

// Per-bedroom rent: exact label key, then a "<label>_*" key, then the anchor.
function resolveRent(label: string, bedrooms: number, sched?: Record<string, number>): number {
  if (sched) {
    if (typeof sched[label] === "number") return sched[label];
    const k = Object.keys(sched).find((key) => key.toLowerCase().startsWith(label.toLowerCase() + "_"));
    if (k) return sched[k];
  }
  return BEDROOM_META[bedrooms].anchorRent;
}

export interface PlannedUnit {
  unit_number: string;
  bedrooms: number;
  bathrooms: number;
  sqft: number;
  monthly_rent: number;
  ami_designation: string | null;
}

// Turn an onboard input into the EXACT list of unit rows to create. When the
// input carries a per-tier `_ami_breakdown` (keys like "1BR_45AMI" /
// "2BR_market" → {units, rent}), units are generated at their TIER rent with
// ami_designation set per tier; otherwise it falls back to the coarse unit_mix
// at the first matching rent_schedule tier (the original behavior). Unit numbers
// are assigned sequentially per bedroom letter (A=1BR, B=2BR, S=Studio) so a
// tier split still yields a contiguous A-101..A-130 with no gaps. Pure (no DB)
// so it is unit-testable. ami_designation honors the units CHECK
// (30/50/60/market/null): tiers outside that set (e.g. 40/45) are stored as
// NULL — their economics live in monthly_rent + the property rent_schedule.
export function buildUnitPlan(input: OnboardInput): PlannedUnit[] {
  const mix = input.unit_mix || {};
  const breakdown = input._ami_breakdown;
  const seqByLetter: Record<string, number> = {};
  const plan: PlannedUnit[] = [];

  const emit = (label: string, count: number, rent: number, ami: string | null): void => {
    const bedrooms = LABEL_TO_BEDROOMS[label.toLowerCase()];
    if (bedrooms === undefined) {
      console.warn(`  skip unknown unit label '${label}'`);
      return;
    }
    const meta = BEDROOM_META[bedrooms];
    for (let i = 0; i < count; i++) {
      const n = (seqByLetter[meta.letter] = (seqByLetter[meta.letter] || 0) + 1);
      const unit_number =
        meta.letter === "S"
          ? `S-${String(n).padStart(3, "0")}`
          : `${meta.letter}-${meta.floor}${String(n).padStart(2, "0")}`;
      plan.push({
        unit_number,
        bedrooms,
        bathrooms: meta.bathrooms,
        sqft: meta.sqft,
        monthly_rent: rent,
        ami_designation: ami,
      });
    }
  };

  if (breakdown && Object.keys(breakdown).length > 0) {
    // Reconcile the breakdown to unit_mix per label (no silent drift).
    const perLabel: Record<string, number> = {};
    for (const [key, spec] of Object.entries(breakdown)) {
      const label = key.slice(0, key.indexOf("_"));
      perLabel[label] = (perLabel[label] || 0) + Number(spec.units);
    }
    for (const [label, n] of Object.entries(perLabel)) {
      if (Number(mix[label] ?? -1) !== n) {
        throw new Error(
          `_ami_breakdown sums to ${n} ${label} but unit_mix says ${mix[label]} — reconcile (no silent drift).`
        );
      }
    }
    for (const [key, spec] of Object.entries(breakdown)) {
      const label = key.slice(0, key.indexOf("_"));
      const tierRaw = key.slice(key.indexOf("_") + 1); // "45AMI" | "40AMI" | "market"
      const ami = /market/i.test(tierRaw) ? "market" : null;
      emit(label, Number(spec.units), Number(spec.rent), ami);
    }
  } else {
    for (const [label, countRaw] of Object.entries(mix)) {
      const bedrooms = LABEL_TO_BEDROOMS[label.toLowerCase()] ?? 0;
      emit(label, Number(countRaw), resolveRent(label, bedrooms, input.rent_schedule), input.ami_designation ?? null);
    }
  }
  return plan;
}

async function run(): Promise<void> {
  const input = loadInput();

  // Rail 1: refuse unconfirmed facts.
  if (input._status && /draft|pending|todo|confirm/i.test(input._status)) {
    console.error(
      `\nABORT: input _status = ${JSON.stringify(input._status)}.\n` +
        `This building's facts are not confirmed yet. Confirm with Frank/GPM ` +
        `(see docs/frank-dl2-launch-factcheck.md), then clear _status and re-run.\n`
    );
    process.exit(2);
  }

  // Required fields.
  for (const f of ["name", "address_line1", "city", "zip", "unit_count"] as const) {
    const v = input[f];
    if (v === undefined || v === null || v === "") {
      console.error(`ABORT: missing required field '${f}'`);
      process.exit(2);
    }
  }

  const slug = slugify(input.name);
  const propType = input.property_type || "family";
  const amiArea = input.ami_area || input.city; // ami_area is NOT NULL in the schema

  // Rail 2: unit_mix (when generating units) must sum to unit_count.
  const mix = input.unit_mix || {};
  const mixTotal = Object.values(mix).reduce((s, n) => s + Number(n), 0);
  const willGenerateUnits = mixTotal > 0;
  if (willGenerateUnits && mixTotal !== Number(input.unit_count)) {
    console.error(
      `ABORT: unit_mix sums to ${mixTotal} but unit_count = ${input.unit_count}. ` +
        `Reconcile the mix and the count (no silent drift).`
    );
    process.exit(2);
  }

  // Match an existing property by the SQL slug derivation the backend uses.
  const matchRes = await query(
    `SELECT id, name, address_line1, city, zip, unit_count, ami_area, phone, email,
            property_manager, property_type, lihtc_type, ami_set_aside, jurisdiction,
            census_tract, latitude, longitude, total_vacancy, waiting_list_enabled
       FROM properties
      WHERE trim(BOTH '-' FROM regexp_replace(LOWER(name), '[^a-z0-9]+', '-', 'g')) = $1
      LIMIT 1`,
    [slug]
  );

  const cols: Record<string, unknown> = {
    name: input.name,
    address_line1: input.address_line1,
    address_line2: input.address_line2 ?? null,
    city: input.city,
    state: input.state || "NV",
    zip: input.zip,
    unit_count: input.unit_count,
    ami_area: amiArea,
    phone: input.phone ?? null,
    email: input.email ?? null,
    property_manager: input.property_manager ?? null,
    property_type: propType,
    lihtc_type: input.lihtc_type ?? null,
    ami_set_aside: input.ami_set_aside ?? null,
    jurisdiction: input.jurisdiction ?? null,
    census_tract: input.census_tract ?? null,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    total_vacancy: input.total_vacancy ?? 0,
    waiting_list_enabled: input.waiting_list_enabled ?? true,
  };

  let propertyId: string;

  if (matchRes.rows.length > 0) {
    const existing = matchRes.rows[0] as Record<string, unknown>;
    propertyId = existing.id as string;
    const diffs: string[] = [];
    for (const k of Object.keys(cols)) {
      if (k === "name") continue; // slug already proved the name match
      if (String(existing[k] ?? "") !== String(cols[k] ?? "")) {
        diffs.push(`  ${k}: ${JSON.stringify(existing[k])} -> ${JSON.stringify(cols[k])}`);
      }
    }
    console.log(`MATCH: '${input.name}' exists (id=${propertyId}). Updating in place.`);
    console.log(diffs.length ? `Changes:\n${diffs.join("\n")}` : "  (no scalar changes; refreshing jsonb + updated_at)");
    await query(
      `UPDATE properties SET
         address_line1=$2, address_line2=$3, city=$4, state=$5, zip=$6, unit_count=$7,
         ami_area=$8, phone=$9, email=$10, property_manager=$11, property_type=$12,
         lihtc_type=$13, ami_set_aside=$14, jurisdiction=$15, census_tract=$16,
         latitude=$17, longitude=$18, total_vacancy=$19, waiting_list_enabled=$20,
         unit_mix=$21::jsonb, rent_schedule=$22::jsonb, updated_at=NOW()
       WHERE id=$1`,
      [propertyId, cols.address_line1, cols.address_line2, cols.city, cols.state, cols.zip,
       cols.unit_count, cols.ami_area, cols.phone, cols.email, cols.property_manager, cols.property_type,
       cols.lihtc_type, cols.ami_set_aside, cols.jurisdiction, cols.census_tract, cols.latitude,
       cols.longitude, cols.total_vacancy, cols.waiting_list_enabled,
       JSON.stringify(mix), JSON.stringify(input.rent_schedule || {})]
    );
  } else {
    const ins = await query(
      `INSERT INTO properties
         (name,address_line1,address_line2,city,state,zip,unit_count,ami_area,phone,email,
          property_manager,property_type,lihtc_type,ami_set_aside,jurisdiction,census_tract,
          latitude,longitude,total_vacancy,waiting_list_enabled,unit_mix,rent_schedule)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,$22::jsonb)
       RETURNING id`,
      [cols.name, cols.address_line1, cols.address_line2, cols.city, cols.state, cols.zip, cols.unit_count,
       cols.ami_area, cols.phone, cols.email, cols.property_manager, cols.property_type, cols.lihtc_type,
       cols.ami_set_aside, cols.jurisdiction, cols.census_tract, cols.latitude, cols.longitude,
       cols.total_vacancy, cols.waiting_list_enabled, JSON.stringify(mix), JSON.stringify(input.rent_schedule || {})]
    );
    propertyId = (ins.rows[0] as { id: string }).id;
    console.log(`INSERT: new property '${input.name}' (id=${propertyId})`);
  }

  // Units: generate the EXACT mix. Idempotent at the (property,unit_number) grain.
  let unitsCreated = 0;
  if (willGenerateUnits) {
    const status = input.unit_status || "available";
    const plan = buildUnitPlan(input);
    for (const u of plan) {
      const res = await query(
        `INSERT INTO units
           (property_id, unit_number, bedrooms, bathrooms, sqft, monthly_rent, status, available_from, ami_designation)
         VALUES ($1,$2,$3,$4,$5,$6,$7, ${status === "available" ? "CURRENT_DATE" : "NULL"}, $8)
         ON CONFLICT (property_id, unit_number) DO NOTHING`,
        [propertyId, u.unit_number, u.bedrooms, u.bathrooms, u.sqft, u.monthly_rent, status, u.ami_designation]
      );
      unitsCreated += ((res as { rowCount?: number | null }).rowCount ?? 0);
    }
  } else {
    console.log("No unit_mix provided -> property row only (units deferred until the confirmed mix is known).");
  }

  const tot = await query(
    `SELECT (SELECT count(*) FROM units WHERE property_id=$1) AS units,
            (SELECT count(*) FROM units WHERE property_id=$1 AND status='available') AS available,
            (SELECT (latitude IS NOT NULL AND longitude IS NOT NULL) FROM properties WHERE id=$1) AS has_coords`,
    [propertyId]
  );
  const t = tot.rows[0] as { units: string; available: string; has_coords: boolean };
  console.log(`\nDone: property ${propertyId} - ${t.units} unit rows (${t.available} available) - on map: ${t.has_coords}`);
  if (!t.has_coords) console.log("NOTE: no coords -> will NOT appear on the /discover map until latitude/longitude are set.");
  if (unitsCreated > 0) console.log(`(${unitsCreated} new unit rows this run; re-runs are no-ops at the unit grain)`);
}

// Only execute as a script — importing this module (e.g. to unit-test
// buildUnitPlan) must not open a DB connection or read argv.
if (require.main === module) {
  run()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("onboard-property failed:", err);
      pool.end().finally(() => process.exit(1));
    });
}
