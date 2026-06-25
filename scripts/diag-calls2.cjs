// READ-ONLY: precise dump of the last 6 voice_intake_calls (all columns we care about).
const { Client } = require("pg");
(async () => {
  const c = new Client({
    connectionString: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();
  try {
    const cols = await c.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name='voice_intake_calls' ORDER BY ordinal_position`
    );
    console.log("voice_intake_calls columns:", cols.rows.map((r) => r.column_name).join(", "));
    const r = await c.query(`SELECT * FROM voice_intake_calls ORDER BY created_at DESC LIMIT 6`);
    console.log(`\n=== last ${r.rows.length} calls ===`);
    for (const row of r.rows) {
      console.log(JSON.stringify({
        created_at: row.created_at,
        from: row.from_number ?? row.caller_phone ?? row.phone ?? row.phone_e164 ?? row.caller,
        duration: row.call_duration_secs ?? row.duration_seconds ?? row.duration_secs ?? row.duration,
        status: row.status,
        conv: row.conversation_id ?? row.elevenlabs_conversation_id,
      }));
    }
  } finally {
    await c.end();
  }
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
