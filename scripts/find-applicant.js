#!/usr/bin/env node
/**
 * One-off read: find a user / application by name fragment (case-insensitive).
 * Run:  railway run --service Postgres node scripts/find-applicant.js jacq
 * (connects over the public proxy, read-only).
 */
const { Pool } = require("pg");
const frag = (process.argv[2] || "").toLowerCase();
if (!frag) { console.error("usage: node scripts/find-applicant.js <name-fragment>"); process.exit(2); }
const conn = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
const pool = new Pool({ connectionString: conn, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 });

(async () => {
  const c = await pool.connect();
  try {
    console.log(`Searching name ~ "${frag}"\n`);
    const u = await c.query(
      `SELECT id, email, first_name, last_name, email_verified_at, created_at
         FROM users
        WHERE lower(first_name) LIKE '%'||$1||'%' OR lower(last_name) LIKE '%'||$1||'%'
        ORDER BY created_at DESC LIMIT 25`, [frag]);
    console.log(`USERS (${u.rows.length}):`);
    u.rows.forEach((r) =>
      console.log(`  "${r.first_name} ${r.last_name}" | ${r.email} | verified=${!!r.email_verified_at} | ${String(r.created_at).slice(0,10)} | ${r.id}`));

    const a = await c.query(
      `SELECT a.id, a.first_name, a.last_name, a.email, a.status, a.claimed_unit_id, a.created_at,
              p.name AS property
         FROM applications a LEFT JOIN properties p ON p.id = a.property_id
        WHERE lower(a.first_name) LIKE '%'||$1||'%' OR lower(a.last_name) LIKE '%'||$1||'%'
        ORDER BY a.created_at DESC LIMIT 25`, [frag]);
    console.log(`\nAPPLICATIONS (${a.rows.length}):`);
    a.rows.forEach((r) =>
      console.log(`  "${r.first_name} ${r.last_name}" | ${r.email} | status=${r.status} | property=${r.property || '-'} | unit=${r.claimed_unit_id || '-'} | ${String(r.created_at).slice(0,10)} | ${r.id}`));
  } catch (e) {
    console.error("FAILED:", e.message);
    process.exit(1);
  } finally {
    c.release();
    await pool.end();
  }
})();
