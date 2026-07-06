#!/usr/bin/env node
/**
 * One-off cleanup (NOT for commit): free the DL2 units held by the two e2e/demo
 * test applications and detach their claims, so real applicants see those units.
 *
 * These apps came through the browser with `?demo=` (query param, not the
 * x-demo-run header), so they are NOT demo_run_id-tagged and scripts/
 * purge-demo-data.mjs won't catch them. We target them by explicit email.
 *
 * DRY-RUN by default; --apply writes (in one transaction). Read-only otherwise.
 *   railway run --service Postgres node scripts/release-demo-claims.js           # dry-run
 *   railway run --service Postgres node scripts/release-demo-claims.js --apply   # write
 */
const { Pool } = require("pg");

const APPLY = process.argv.includes("--apply");
const EMAILS = [
  "dl2.smoke.0624@example.com",
  "dl2.walkthrough.0624@example.com",
];

const conn = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
if (!conn) { console.error("No DATABASE_PUBLIC_URL/DATABASE_URL"); process.exit(2); }
const host = (conn.split("@")[1] || "?").split("/")[0];
console.log(`[release-demo-claims] ${APPLY ? "APPLY" : "DRY-RUN"} · host ${host}`);

const pool = new Pool({ connectionString: conn, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 });

(async () => {
  const client = await pool.connect();
  try {
    const found = await client.query(
      `SELECT a.id AS application_id, a.email, a.status, a.claimed_unit_id,
              u.unit_number, u.status AS unit_status, u.monthly_rent, p.name AS property
         FROM applications a
         JOIN units u ON u.id = a.claimed_unit_id
         LEFT JOIN properties p ON p.id = u.property_id
        WHERE a.email = ANY($1) AND a.claimed_unit_id IS NOT NULL
        ORDER BY u.unit_number`,
      [EMAILS]
    );
    console.log(`demo claims to release: ${found.rows.length}`);
    found.rows.forEach((r) =>
      console.log(`  ${r.unit_number} ($${r.monthly_rent}, ${r.unit_status}) @ ${r.property} <- app ${r.application_id} ${r.status} ${r.email}`)
    );
    if (found.rows.length === 0) { console.log("nothing to do."); process.exit(0); }

    // Safety: confirm none of these apps belong to a non-example.com identity.
    const bad = found.rows.filter((r) => !/@example\.com$/i.test(r.email));
    if (bad.length) {
      console.error("ABORT: a non-example.com email is in the set — refusing.", bad.map((b) => b.email));
      process.exit(1);
    }

    if (!APPLY) {
      console.log("\nDRY-RUN — with --apply: free each unit (status='available', claim_expires_at=NULL) and null the app's claimed_unit_id. The demo apps are left in place (orphaned, harmless); units become bookable.");
      process.exit(0);
    }

    await client.query("BEGIN");
    let freed = 0;
    for (const r of found.rows) {
      await client.query(
        `UPDATE units SET status='available', claim_expires_at=NULL WHERE id=$1`,
        [r.claimed_unit_id]
      );
      await client.query(
        `UPDATE applications SET claimed_unit_id=NULL WHERE id=$1`,
        [r.application_id]
      );
      freed += 1;
    }
    await client.query("COMMIT");
    console.log(`freed ${freed} unit(s).`);

    const ver = await client.query(
      `SELECT unit_number, status FROM units
        WHERE unit_number = ANY($1) AND property_id = (
          SELECT id FROM properties WHERE trim(BOTH '-' FROM regexp_replace(LOWER(name),'[^a-z0-9]+','-','g'))='donna-louise-apartments-2')
        ORDER BY unit_number`,
      [found.rows.map((r) => r.unit_number)]
    );
    console.log("verify:");
    ver.rows.forEach((r) => console.log(`  ${r.unit_number} -> ${r.status}`));
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
