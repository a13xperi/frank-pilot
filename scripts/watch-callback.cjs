// Live watcher: narrates any follow_up created in the last 15 min (a row from
// Frank's own schedule_followup, or the post-call net), through its lifecycle:
// appears -> dialer claims (in_progress) -> outbound_conversation_id set.
const { Client } = require("pg");
const DEADLINE = 10 * 60 * 1000;
const STEP = 12 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().slice(11, 19) + "Z";

(async () => {
  const c = new Client({
    connectionString: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();
  console.log(`[${stamp()}] watching for a fresh follow_up (Frank wrapped + scheduled, or the net)...`);
  const seen = {};
  let announced = false, convoSeen = false;
  const start = Date.now();
  try {
    while (Date.now() - start < DEADLINE) {
      const r = await c.query(
        `SELECT id, phone_e164, reason, status, checkpoint, outbound_conversation_id, attempts, created_at
           FROM follow_ups WHERE created_at > now() - interval '15 minutes'
          ORDER BY created_at DESC`
      );
      for (const row of r.rows) {
        if (!announced) {
          console.log(`\n[${stamp()}] ★ NEW follow_up — Frank acted (or the net fired)`);
          console.log(`   phone=${row.phone_e164} reason=${row.reason} status=${row.status}`);
          console.log(`   checkpoint: ${row.checkpoint || "(none)"}`);
          announced = true;
        }
        if (seen[row.id] && seen[row.id] !== row.status)
          console.log(`[${stamp()}] status ${seen[row.id]} -> ${row.status} (attempts=${row.attempts})`);
        seen[row.id] = row.status;
        if (row.outbound_conversation_id && !convoSeen) {
          convoSeen = true;
          console.log(`\n[${stamp()}] ✓ CALLBACK PLACED  conv=${row.outbound_conversation_id}`);
        }
      }
      if (convoSeen) { console.log(`\n[${stamp()}] done.`); break; }
      await sleep(STEP);
    }
    if (!announced) console.log(`[${stamp()}] timed out — no new follow_up. (Frank may not have called schedule_followup.)`);
  } finally { await c.end(); }
})().catch((e) => { console.error("WATCHER FAILED:", e.message); process.exit(1); });
