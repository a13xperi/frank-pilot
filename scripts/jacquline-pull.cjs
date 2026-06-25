// Everything we have on Jacquline (+17022017719) across the frank-pilot DB.
const { Client } = require("pg");
const PHONE = "+17022017719";
function meta(rp){return (rp&&(rp.metadata||(rp.data&&rp.data.metadata)))||{};}
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_PUBLIC_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const dump = (label, rows) => { console.log(`\n===== ${label} (${rows.length}) =====`); rows.forEach(r=>console.log(JSON.stringify(r))); };
  try {
    // applications (full)
    try { const a = await c.query(`SELECT * FROM applications WHERE phone=$1 ORDER BY created_at DESC`, [PHONE]); dump("APPLICATIONS", a.rows); }
    catch(e){ console.log("applications err:", e.message); }
    // follow-ups
    try { const f = await c.query(`SELECT id,reason,status,scheduled_for,attempts,checkpoint,notes,created_at FROM follow_ups WHERE phone_e164=$1 ORDER BY created_at DESC`, [PHONE]); dump("FOLLOW_UPS", f.rows); }
    catch(e){ console.log("follow_ups err:", e.message); }
    // caller history
    try { const h = await c.query(`SELECT * FROM caller_history WHERE phone=$1 OR phone_e164=$1`, [PHONE]); dump("CALLER_HISTORY", h.rows); }
    catch(e){ console.log("caller_history err:", e.message); }
    // her calls (filter voice_intake_calls by raw_payload external_number)
    const calls = await c.query(`SELECT conversation_id, started_at, ended_at, call_successful, callback_requested,
        transcript_url, data_collection_results, evaluation_criteria_results, name_confirmed, name_roster_match, raw_payload, created_at
        FROM voice_intake_calls ORDER BY created_at DESC`);
    const hers = calls.rows.filter(r => (meta(r.raw_payload).phone_call||{}).external_number === PHONE);
    console.log(`\n===== HER CALLS (${hers.length}) =====`);
    for (const r of hers) {
      const m = meta(r.raw_payload);
      console.log(`\n- ${r.conversation_id}  ${r.created_at instanceof Date ? r.created_at.toISOString():r.created_at}`);
      console.log(`  dur=${m.call_duration_secs}s successful=${r.call_successful} callback_requested=${r.callback_requested} name_confirmed=${r.name_confirmed} roster_match=${r.name_roster_match}`);
      console.log(`  data_collection:`, JSON.stringify(r.data_collection_results||{}).slice(0,600));
      console.log(`  eval:`, JSON.stringify(r.evaluation_criteria_results||{}).slice(0,400));
    }
    // emit conv ids for transcript pull
    console.log("\nCONV_IDS=" + hers.map(r=>r.conversation_id).join(","));
  } finally { await c.end(); }
})().catch((e)=>{console.error("FAILED:",e.message);process.exit(1);});
