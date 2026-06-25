// Live watcher for the call-time test. Polls follow_ups, ignores the 2 baseline
// rows, and narrates the lifecycle of any NEW row:
//   appears (post-call safety net) -> claimed by dialer (in_progress)
//   -> outbound_conversation_id set (callback placed).
// Exits when the callback is placed, or after ~10 min.
const { Client } = require("pg");
const BASELINE = new Set([
  "52f4da08-d2f7-43a8-b05f-82a4313b2025",
  "6e218b55-2c06-4eb7-97b0-b84462e49361",
]);
const DEADLINE = 10 * 60 * 1000;
const STEP = 12 * 1000;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function stamp() { return new Date().toISOString().slice(11, 19) + "Z"; }

(async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log(`[${stamp()}] watching for the cutoff callback row...`);
  const seenStatus = {};
  let announcedNew = false;
  let convoSeen = false;
  const start = Date.now();
  try {
    while (Date.now() - start < DEADLINE) {
      const r = await client.query(
        `SELECT id, phone_e164, reason, status, scheduled_for, checkpoint,
                outbound_conversation_id, attempts
           FROM follow_ups
          WHERE created_at > now() - interval '15 minutes'
          ORDER BY created_at DESC NULLS LAST`
      );
      for (const row of r.rows) {
        if (!announcedNew) {
          console.log(`\n[${stamp()}] ★ NEW ROW — safety net fired`);
          console.log(`   phone=${row.phone_e164} reason=${row.reason} status=${row.status}`);
          console.log(`   checkpoint: ${row.checkpoint || "(none)"}`);
          announcedNew = true;
        }
        const prev = seenStatus[row.id];
        if (prev && prev !== row.status) {
          console.log(`[${stamp()}] status ${prev} -> ${row.status} (attempts=${row.attempts})`);
        }
        seenStatus[row.id] = row.status;
        if (row.outbound_conversation_id && !convoSeen) {
          convoSeen = true;
          console.log(`\n[${stamp()}] ✓ CALLBACK PLACED — dialer rang back`);
          console.log(`   outbound_conversation_id=${row.outbound_conversation_id}`);
          console.log(`   (answer your phone — Frank should resume with the checkpoint)`);
        }
      }
      if (convoSeen) { console.log(`\n[${stamp()}] done — full loop proven.`); break; }
      await sleep(STEP);
    }
    if (!announcedNew) console.log(`[${stamp()}] timed out — no new row appeared. Did the call run >150s and end?`);
    else if (!convoSeen) console.log(`[${stamp()}] row created but dialer hasn't claimed it within the window (check dialer tick / call window).`);
  } finally {
    await client.end();
  }
})().catch((e) => { console.error("WATCHER FAILED:", e.message); process.exit(1); });
