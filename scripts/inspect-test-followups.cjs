// READ-ONLY: show the two seed/test follow_ups + the open-loop count, so we can
// confirm what the dialer would call before deciding to prune.
const { Client } = require("pg");
const IDS = [
  "5a74627e-bbc4-4241-aa95-c858235a9fab",
  "ea331132-c303-4757-ba0e-82a48e861b66",
];
(async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const r = await client.query(
      `SELECT id, phone_e164, reason, status, scheduled_for, notes
         FROM follow_ups WHERE id = ANY($1::uuid[]) ORDER BY id`,
      [IDS]
    );
    console.log("=== the two flagged rows ===");
    console.table(r.rows);
    const open = await client.query(
      `SELECT id, phone_e164, reason, status, scheduled_for
         FROM follow_ups WHERE status IN ('pending','in_progress')
         ORDER BY scheduled_for`
    );
    console.log(`=== ALL open (pending/in_progress) follow_ups: ${open.rows.length} ===`);
    console.table(open.rows);
  } finally {
    await client.end();
  }
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
