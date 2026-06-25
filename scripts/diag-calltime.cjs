// READ-ONLY diagnostic: did an inbound call land, how long, and did a follow_up appear?
const { Client } = require("pg");
(async () => {
  const c = new Client({
    connectionString: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();
  try {
    console.log("=== follow_ups now ===");
    const fu = await c.query(
      `SELECT phone_e164, reason, status, scheduled_for, created_at
         FROM follow_ups ORDER BY created_at DESC NULLS LAST LIMIT 10`
    );
    for (const r of fu.rows) console.log(" ", r.created_at, "|", r.phone_e164, "|", r.reason, "|", r.status);

    // Recent inbound calls — schema-tolerant: find the call table + duration col.
    const cols = await c.query(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_name ILIKE '%call%' AND (column_name ILIKE '%duration%' OR column_name ILIKE '%phone%' OR column_name ILIKE '%created%')
        ORDER BY table_name, column_name`
    );
    const tables = [...new Set(cols.rows.map((r) => r.table_name))];
    console.log("\n=== call-ish tables:", tables.join(", "), "===");
    for (const t of tables) {
      try {
        const r = await c.query(`SELECT * FROM ${t} ORDER BY created_at DESC NULLS LAST LIMIT 3`);
        console.log(`\n--- ${t} (latest ${r.rows.length}) ---`);
        for (const row of r.rows) {
          const dur = row.call_duration_secs ?? row.duration_secs ?? row.duration ?? "?";
          const ph = row.phone ?? row.phone_e164 ?? row.from_number ?? row.caller ?? "?";
          console.log(`  ${row.created_at} | ${ph} | dur=${dur}s | ${row.status ?? ""} | conv=${row.conversation_id ?? row.elevenlabs_conversation_id ?? ""}`);
        }
      } catch (e) { console.log(`  (skip ${t}: ${e.message})`); }
    }
  } finally {
    await c.end();
  }
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
