const { Client } = require("pg");
const CONV = "conv_9601kvy5gdqxfnpbga3rc8pt887b";
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_PUBLIC_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    console.log("=== the callback follow_up row now ===");
    const fu = await c.query(
      `SELECT phone_e164, reason, status, attempts, outbound_conversation_id
         FROM follow_ups WHERE outbound_conversation_id = $1`, [CONV]);
    for (const r of fu.rows) console.log(JSON.stringify(r));

    console.log("\n=== callback leg in voice_intake_calls ===");
    const vc = await c.query(
      `SELECT conversation_id, call_successful, started_at, ended_at,
              EXTRACT(EPOCH FROM (ended_at - started_at))::int AS dur,
              data_collection_results, raw_payload
         FROM voice_intake_calls WHERE conversation_id = $1`, [CONV]);
    if (!vc.rows.length) console.log("  (still no webhook for the callback leg — call may be live/unanswered)");
    for (const r of vc.rows) {
      console.log("  success:", r.call_successful, "| dur:", r.dur + "s");
      // Look for evidence get_call_context fired (tool name appears in the raw payload transcript).
      const blob = JSON.stringify(r.raw_payload || {});
      console.log("  get_call_context called?:", blob.includes("get_call_context") ? "YES" : "no/unknown");
      console.log("  resume checkpoint echoed?:", /pick up exactly|left off|income doc|2-bedroom|DL2/i.test(blob) ? "YES" : "no/unknown");
    }

    console.log("\n=== ALL follow_ups (watch for loop rows) ===");
    const all = await c.query(`SELECT phone_e164, reason, status, created_at FROM follow_ups ORDER BY created_at DESC`);
    console.log("  total:", all.rows.length);
    for (const r of all.rows) console.log("  ", r.created_at, r.phone_e164, r.reason, r.status);
  } finally { await c.end(); }
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
