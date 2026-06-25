// One-shot: inspect + delete the two seed/test follow_ups so the dialer never
// rings the fictional 555 numbers once FRANK_FOLLOWUP_ENABLED flips on.
// Run via:  railway run -s api -e production node scripts/prune-test-followups.cjs
const { Client } = require("pg");

// The 4 fictional 555 rows + the past-due FRANK_OUTBOUND_TEST_NUMBER row.
// Deliberately EXCLUDES 6e218b55 (+13038774546) — a real caller who asked for a
// later callback (bad_time, scheduled 6/26). Keep that one.
const IDS = [
  "5a74627e-bbc4-4241-aa95-c858235a9fab", // +17025550111 time_cutoff
  "5d53dfda-484b-48ae-ac72-61587098c0d2", // +17025558888 needs_info
  "926823d6-071e-4e54-9e33-4b9f618ed880", // +17025557777 needs_info
  "ea331132-c303-4757-ba0e-82a48e861b66", // +17025550100 needs_info (smoke)
  "0b2221d1-307e-4352-a2ae-f09c99c49237", // +17023356630 test number, past-due
];

(async () => {
  // Prefer the public proxy URL (resolvable off-network); fall back to the
  // internal one when run inside Railway.
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error("NO DATABASE_PUBLIC_URL/DATABASE_URL in env — aborting, deleted nothing.");
    process.exit(1);
  }
  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const before = await client.query(
      `SELECT id, phone_e164, reason, status, scheduled_for, notes
         FROM follow_ups WHERE id = ANY($1::uuid[]) ORDER BY id`,
      [IDS]
    );
    console.log("=== matched rows (will delete) ===");
    console.table(before.rows);
    if (before.rows.length === 0) {
      console.log("Nothing matched — already pruned. No-op.");
      return;
    }
    const del = await client.query(
      `DELETE FROM follow_ups WHERE id = ANY($1::uuid[]) RETURNING id`,
      [IDS]
    );
    console.log(`Deleted ${del.rowCount} row(s):`, del.rows.map((r) => r.id));

    const remaining = await client.query(
      `SELECT count(*)::int AS n, count(*) FILTER (WHERE status IN ('pending','in_progress'))::int AS open
         FROM follow_ups`
    );
    console.log("=== follow_ups now ===");
    console.table(remaining.rows);
  } finally {
    await client.end();
  }
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
