// READ-ONLY: every follow_up still in the table, newest first, with notes.
const { Client } = require("pg");
(async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const r = await client.query(
      `SELECT id, phone_e164, reason, status, scheduled_for, checkpoint, notes
         FROM follow_ups ORDER BY created_at DESC NULLS LAST, scheduled_for DESC`
    );
    console.log(`=== ${r.rows.length} row(s) total ===`);
    for (const row of r.rows) {
      console.log("-", row.phone_e164, "|", row.reason, "|", row.status,
        "| sched", row.scheduled_for, "| id", row.id);
      if (row.checkpoint) console.log("    checkpoint:", row.checkpoint);
      if (row.notes) console.log("    notes:", row.notes);
    }
  } finally {
    await client.end();
  }
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
