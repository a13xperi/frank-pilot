#!/usr/bin/env node
/**
 * One-off operator resync for Donna Louise 2 units (NOT for commit).
 *
 * Mirrors src/db/onboard-property.ts (unit-number scheme + per-bedroom rents,
 * verified against that source) and adds the one thing the loader can't do:
 * a GUARDED DELETE of DL2's stale placeholder units. The loader is
 * ON CONFLICT (property_id, unit_number) DO NOTHING, so the stale A-101.. /
 * B-201.. rows would block the correct ones — they must be removed first.
 *
 * Safe by construction:
 *   - DRY-RUN by default; pass --apply to write.
 *   - The DELETE is NOT EXISTS-guarded against any application claim or
 *     compliance tape, and aborts up front if any unit is referenced.
 *   - All writes run in ONE transaction (BEGIN/COMMIT, ROLLBACK on error).
 *   - Connects over the public proxy with self-signed SSL, exactly like
 *     src/config/database.ts.
 *
 * Run with the prod DB vars injected (the Postgres service has the public URL):
 *   railway run --service Postgres node scripts/dl2-resync-oneoff.js           # dry-run
 *   railway run --service Postgres node scripts/dl2-resync-oneoff.js --apply   # write
 */
const { Pool } = require("pg");

const APPLY = process.argv.includes("--apply");
const slugArg = process.argv.find((a) => a.startsWith("--slug="));
const SLUG = slugArg ? slugArg.slice("--slug=".length) : "donna-louise-apartments-2";

// EXACT unit breakdown transcribed from the official AMI form for DONNA LOUISE II
// (photo IMG_2142.HEIC, provided by DORA, 2026-06-23). Each tier carries its own
// rent and max annual-income cap; the per-unit AMI tier is set here (not deferred
// to OneSite) so the live inventory mirrors the form precisely.
const AMI_SET_ASIDE =
  "40%/45% AMI: 30 1BR + 12 2BR affordable; 6 2BR market-rate (per Dora AMI form 2026-06-23)";
const RENT_SCHEDULE = {
  "1BR_45AMI": 890, "1BR_40AMI": 791,
  "2BR_45AMI": 1068, "2BR_40AMI": 950, "2BR_market": 1634,
};
// label, tier ("45"/"40"/"market"), rent, count, income_cap (annual; null = none),
// + unit geometry. Unit numbers are assigned sequentially per letter (A=1BR, B=2BR).
const UNIT_SPEC = [
  { label: "1BR", tier: "45",     rent: 890,  count: 28, income_cap: 33255, bedrooms: 1, bathrooms: 1.0, sqft: 650, letter: "A", floor: 1 },
  { label: "1BR", tier: "40",     rent: 791,  count: 2,  income_cap: 29560, bedrooms: 1, bathrooms: 1.0, sqft: 650, letter: "A", floor: 1 },
  { label: "2BR", tier: "45",     rent: 1068, count: 10, income_cap: 37980, bedrooms: 2, bathrooms: 1.5, sqft: 900, letter: "B", floor: 2 },
  { label: "2BR", tier: "40",     rent: 950,  count: 2,  income_cap: 33760, bedrooms: 2, bathrooms: 1.5, sqft: 900, letter: "B", floor: 2 },
  { label: "2BR", tier: "market", rent: 1634, count: 6,  income_cap: null,  bedrooms: 2, bathrooms: 1.5, sqft: 900, letter: "B", floor: 2 },
];

function desiredUnits() {
  const out = [];
  const seqByLetter = {};
  for (const s of UNIT_SPEC) {
    for (let i = 0; i < s.count; i++) {
      const next = (seqByLetter[s.letter] = (seqByLetter[s.letter] || 0) + 1);
      const seq = String(next).padStart(2, "0");
      out.push({
        unit_number: `${s.letter}-${s.floor}${seq}`,
        bedrooms: s.bedrooms, bathrooms: s.bathrooms, sqft: s.sqft,
        rent: s.rent, ami_designation: s.tier,
      });
    }
  }
  return out;
}

// Property-level unit_mix (by bedroom) derived from the spec: {"1BR":30,"2BR":18}.
const UNIT_MIX = UNIT_SPEC.reduce((m, s) => { m[s.label] = (m[s.label] || 0) + s.count; return m; }, {});

const conn = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
if (!conn) {
  console.error(
    "No DATABASE_PUBLIC_URL / DATABASE_URL in env.\n" +
    "Run via:  railway run --service Postgres node scripts/dl2-resync-oneoff.js"
  );
  process.exit(2);
}
const which = process.env.DATABASE_PUBLIC_URL ? "DATABASE_PUBLIC_URL" : "DATABASE_URL";
const host = (conn.split("@")[1] || "?").split("/")[0];
console.log(`[dl2-resync] ${APPLY ? "APPLY" : "DRY-RUN"} · via ${which} · host ${host}`);

const pool = new Pool({
  connectionString: conn,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
});

(async () => {
  const client = await pool.connect();
  try {
    const pr = await client.query(
      `SELECT id, name, ami_set_aside, rent_schedule FROM properties
        WHERE trim(BOTH '-' FROM regexp_replace(LOWER(name), '[^a-z0-9]+', '-', 'g')) = $1
        LIMIT 1`,
      [SLUG]
    );
    if (!pr.rows.length) {
      console.error(`No property matches slug '${SLUG}'. Candidates (name → derived slug):`);
      const cand = await client.query(
        `SELECT id, name, unit_count,
                trim(BOTH '-' FROM regexp_replace(LOWER(name), '[^a-z0-9]+', '-', 'g')) AS slug,
                (rent_schedule IS NOT NULL AND rent_schedule::text <> '{}') AS has_rent_schedule,
                (SELECT count(*) FROM units u WHERE u.property_id = properties.id) AS units
           FROM properties
          WHERE name ILIKE '%donna%' OR name ILIKE '%louise%'
          ORDER BY name`
      );
      if (!cand.rows.length) console.error("  (none matching donna/louise)");
      cand.rows.forEach((r) =>
        console.error(`  "${r.name}"  →  ${r.slug}  · id=${r.id} · unit_count=${r.unit_count} · units=${r.units} · rent_schedule=${r.has_rent_schedule}`)
      );
      process.exit(1);
    }
    const propId = pr.rows[0].id;
    console.log(`property: ${pr.rows[0].name} (${propId})`);
    console.log(`  ami_set_aside: ${pr.rows[0].ami_set_aside}`);
    console.log(`  rent_schedule: ${JSON.stringify(pr.rows[0].rent_schedule)}`);

    const cur = await client.query(
      `SELECT unit_number, bedrooms, monthly_rent FROM units WHERE property_id = $1 ORDER BY unit_number`,
      [propId]
    );
    console.log(`current units: ${cur.rows.length}`);
    const byRent = {};
    cur.rows.forEach((r) => { const k = `${r.bedrooms}BR $${r.monthly_rent}`; byRent[k] = (byRent[k] || 0) + 1; });
    Object.entries(byRent).forEach(([k, n]) => console.log(`  ${k}  ×${n}`));

    // Known TEST/QA application claims on DL2 units, to release by EXPLICIT id
    // (verified from the diagnostic — neither is a real applicant):
    //   77950ae8…  test@test1.com            "Test User"   (screening_passed, May 22)
    //   c4541bd5…  qa-walk-…@example.com      "Demo Walker" (submitted,        May 26)
    const RELEASE_APP_IDS = [
      "77950ae8-e4ed-4482-be20-0cd775c1055c",
      "c4541bd5-8685-4606-a0df-9172bae496e2",
    ];

    // Show the claims we plan to release (read-only).
    const rel = await client.query(
      `SELECT u.unit_number, a.id, a.status, a.email, a.first_name, a.last_name
         FROM units u JOIN applications a ON a.claimed_unit_id = u.id
        WHERE u.property_id = $1 AND a.id = ANY($2::uuid[]) ORDER BY u.unit_number`,
      [propId, RELEASE_APP_IDS]
    );
    console.log(`test claims to release (by id): ${rel.rows.length}`);
    rel.rows.forEach((r) =>
      console.log(`  release ${r.unit_number} <- ${r.id} ${r.status} ${r.email} "${r.first_name} ${r.last_name}"`)
    );

    // Any reference NOT covered by that explicit release list, or any compliance
    // tape, is UNEXPECTED — refuse to write and show it.
    const ref = await client.query(
      `SELECT count(*) n FROM units u WHERE u.property_id = $1
         AND ( EXISTS (SELECT 1 FROM applications a WHERE a.claimed_unit_id = u.id AND a.id <> ALL($2::uuid[]))
            OR EXISTS (SELECT 1 FROM compliance_tape c WHERE c.subject_unit_id = u.id) )`,
      [propId, RELEASE_APP_IDS]
    );
    const unexpected = Number(ref.rows[0].n);
    console.log(`referenced by NON-test claims / compliance tape: ${unexpected}`);
    if (unexpected > 0) {
      const det = await client.query(
        `SELECT u.unit_number, u.monthly_rent, a.id AS application_id, a.status, a.email,
                a.first_name, a.last_name, a.created_at
           FROM units u JOIN applications a ON a.claimed_unit_id = u.id
          WHERE u.property_id = $1 AND a.id <> ALL($2::uuid[]) ORDER BY a.created_at`,
        [propId, RELEASE_APP_IDS]
      );
      det.rows.forEach((r) =>
        console.error(
          `  UNEXPECTED unit ${r.unit_number} ($${r.monthly_rent}) <- app ${r.application_id} ` +
          `status=${r.status} email=${r.email} name="${r.first_name} ${r.last_name}" created=${(r.created_at || "").toString().slice(0, 10)}`
        )
      );
      console.error("\nABORT (no writes): an unexpected (possibly REAL) reference exists. Escalate to Alex.");
      process.exit(1);
    }

    const desired = desiredUnits();
    console.log(`desired: ${desired.length} units (per Dora AMI form):`);
    UNIT_SPEC.forEach((s) =>
      console.log(
        `  ${s.count}× ${s.label} @ ${s.tier === "market" ? "market" : s.tier + "% AMI"}  $${s.rent}` +
        (s.income_cap ? `  (income cap $${s.income_cap})` : "  (no income cap)")
      )
    );

    if (!APPLY) {
      console.log(
        "\nDRY-RUN — no writes. With --apply this will, in one transaction:\n" +
        "  1. UPDATE the property's unit_mix / rent_schedule / ami_set_aside\n" +
        `  2. DELETE the ${cur.rows.length} current (unreferenced) units\n` +
        `  3. INSERT the ${desired.length} real units\n` +
        "Re-run with --apply to execute."
      );
      process.exit(0);
    }

    await client.query("BEGIN");
    // Release the known test/QA claims by explicit id so their units become
    // deletable (FK is ON DELETE SET NULL anyway; this makes intent explicit and
    // leaves no orphaned claim pointing at a recreated unit).
    const released = await client.query(
      `UPDATE applications SET claimed_unit_id = NULL
        WHERE property_id = $1 AND id = ANY($2::uuid[])`,
      [propId, RELEASE_APP_IDS]
    );
    console.log(`released test claims: ${released.rowCount}`);
    await client.query(
      `UPDATE properties SET unit_mix = $2::jsonb, rent_schedule = $3::jsonb, ami_set_aside = $4, updated_at = NOW()
        WHERE id = $1`,
      [propId, JSON.stringify(UNIT_MIX), JSON.stringify(RENT_SCHEDULE), AMI_SET_ASIDE]
    );
    const del = await client.query(
      `DELETE FROM units u WHERE u.property_id = $1
         AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.claimed_unit_id = u.id)
         AND NOT EXISTS (SELECT 1 FROM compliance_tape c WHERE c.subject_unit_id = u.id)`,
      [propId]
    );
    console.log(`deleted: ${del.rowCount}`);
    let created = 0;
    for (const u of desired) {
      const r = await client.query(
        `INSERT INTO units
           (property_id, unit_number, bedrooms, bathrooms, sqft, monthly_rent, status, available_from, ami_designation)
         VALUES ($1, $2, $3, $4, $5, $6, 'available', CURRENT_DATE, NULL)
         ON CONFLICT (property_id, unit_number) DO NOTHING`,
        [propId, u.unit_number, u.bedrooms, u.bathrooms, u.sqft, u.rent]
      );
      // NOTE: units.ami_designation has a CHECK allowing only 30/50/60/market/null;
      // DL2's 40/45% tiers aren't valid there, so we leave it NULL (as the loader
      // does). The per-tier rent lives in monthly_rent; the tier mix lives in the
      // property rent_schedule. Final per-unit designation is set in OneSite.
      created += r.rowCount;
    }
    console.log(`created: ${created}`);
    await client.query("COMMIT");

    const ver = await client.query(
      `SELECT bedrooms, monthly_rent, count(*) n FROM units WHERE property_id = $1
        GROUP BY bedrooms, monthly_rent ORDER BY bedrooms, monthly_rent`,
      [propId]
    );
    console.log("verify:");
    ver.rows.forEach((r) => console.log(`  ${r.bedrooms}BR  $${r.monthly_rent}  ×${r.n}`));
    console.log("DONE");
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("FAILED:", e.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
})();
