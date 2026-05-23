#!/usr/bin/env node
// Reap accounts created during usability/demo walkthroughs.
//
// Every signup made via a `?demo=<TOKEN>` deep link is tagged with
// users.demo_run_id (the per-tab runId). This script deletes those rows so a
// testing round leaves no residue in the real applicant funnel. Magic-link
// tokens, user_applications, applications etc. cascade or are cleaned via the
// users FK chain (ON DELETE CASCADE on magic_link_tokens; application rows are
// reported so an operator can decide).
//
// Usage:
//   node scripts/purge-demo-data.mjs --list                 # show demo rows, delete nothing
//   node scripts/purge-demo-data.mjs --run <RUN_ID>          # purge one run
//   node scripts/purge-demo-data.mjs --all --yes             # purge every demo row
//
// Requires DATABASE_URL (same env the app uses). Dry-run by default: without
// --yes (or with --list) it only reports. Captured replay/event artifacts in
// Supabase storage (demo/{runId}/…) are NOT touched here — delete those from
// the bucket separately if needed.

import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const valOf = (f) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};

const LIST = has('--list');
const ALL = has('--all');
const RUN = valOf('--run');
const CONFIRM = has('--yes');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required (point it at the target DB).');
  process.exit(1);
}
if (!LIST && !ALL && !RUN) {
  console.error('Specify one of: --list | --run <RUN_ID> | --all --yes');
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

function scopeClause() {
  if (RUN) return { sql: 'demo_run_id = $1', params: [RUN] };
  return { sql: 'demo_run_id IS NOT NULL', params: [] };
}

async function main() {
  const { sql, params } = scopeClause();

  const preview = await pool.query(
    `SELECT demo_run_id, COUNT(*)::int AS users,
            MIN(created_at) AS first_seen, MAX(created_at) AS last_seen
       FROM users
      WHERE ${sql}
      GROUP BY demo_run_id
      ORDER BY last_seen DESC`,
    params,
  );

  if (preview.rows.length === 0) {
    console.log('No demo accounts match.');
    await pool.end();
    return;
  }

  console.log('Demo accounts:');
  let total = 0;
  for (const r of preview.rows) {
    total += r.users;
    console.log(
      `  ${r.demo_run_id}  ${r.users} user(s)  ${new Date(r.first_seen).toISOString()} → ${new Date(r.last_seen).toISOString()}`,
    );
  }
  console.log(`  total: ${total} user(s)`);

  if (LIST || (!CONFIRM && !RUN)) {
    if (!LIST) console.log('\nDry run — re-run with --yes to delete.');
    await pool.end();
    return;
  }
  if (ALL && !CONFIRM) {
    console.log('\n--all requires --yes to actually delete.');
    await pool.end();
    return;
  }

  // Delete. magic_link_tokens cascade via FK. Report application rows that
  // reference these users so they aren't silently orphaned.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const apps = await client.query(
      `SELECT COUNT(*)::int AS n
         FROM user_applications ua
         JOIN users u ON u.id = ua.user_id
        WHERE u.${sql}`,
      params,
    );
    const del = await client.query(`DELETE FROM users WHERE ${sql} RETURNING id`, params);
    await client.query('COMMIT');
    console.log(`\nDeleted ${del.rowCount} user(s).`);
    if (apps.rows[0]?.n > 0) {
      console.log(
        `Note: ${apps.rows[0].n} user_application link(s) referenced these users (cascade/orphan policy is FK-defined).`,
      );
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Purge failed, rolled back:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
