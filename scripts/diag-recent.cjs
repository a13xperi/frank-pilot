const { Client } = require("pg");
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_PUBLIC_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    const calls = await c.query(
      `SELECT conversation_id, started_at, ended_at, call_successful,
              EXTRACT(EPOCH FROM (ended_at - started_at))::int AS dur
         FROM voice_intake_calls
        WHERE created_at > now() - interval '45 minutes'
        ORDER BY created_at DESC`
    );
    console.log(`=== inbound calls in last 45 min: ${calls.rows.length} ===`);
    for (const r of calls.rows)
      console.log(" ", r.started_at, "dur=" + r.dur + "s", "ok=" + r.call_successful, r.conversation_id);
    const fu = await c.query(`SELECT count(*)::int n FROM follow_ups`);
    console.log("follow_ups total:", fu.rows[0].n);
  } finally { await c.end(); }
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
