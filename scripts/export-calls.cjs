// Structured export of every logged call (voice_intake_calls) → CSV + JSON + summary.
// Run: railway run -s Postgres -e production -p <proj> node scripts/export-calls.cjs
const { Client } = require("pg");
const fs = require("fs");

const OUT_DIR = "/Users/A13xPeri/code/battlestation/out";
const CSV = `${OUT_DIR}/frank-calls-log.csv`;
const JSONF = `${OUT_DIR}/frank-calls-log.json`;

function pick(rp, path) { let o = rp; for (const k of path) o = o && o[k]; return o; }
function meta(rp) { return (rp && (rp.metadata || (rp.data && rp.data.metadata))) || {}; }
function csvCell(v) {
  if (v === null || v === undefined) return "";
  const s = String(v).replace(/"/g, '""').replace(/\r?\n/g, " ");
  return /[",]/.test(s) ? `"${s}"` : s;
}

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_PUBLIC_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    const r = await c.query(
      `SELECT conversation_id, agent_id, started_at, ended_at, call_successful,
              callback_requested, applicant_id, raw_payload, created_at
         FROM voice_intake_calls ORDER BY created_at ASC`
    );
    const cols = ["created_at","conversation_id","direction","caller_number","agent_number",
      "started_at","ended_at","duration_secs","call_successful","termination_reason",
      "callback_requested","applicant_id"];
    const rows = r.rows.map((row) => {
      const rp = row.raw_payload || {};
      const m = meta(rp);
      const pc = m.phone_call || {};
      const dur = m.call_duration_secs ??
        (row.started_at && row.ended_at ? Math.round((new Date(row.ended_at) - new Date(row.started_at)) / 1000) : null);
      return {
        created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
        conversation_id: row.conversation_id,
        direction: pc.direction ?? "",
        caller_number: pc.external_number ?? "",
        agent_number: pc.agent_number ?? "",
        started_at: row.started_at instanceof Date ? row.started_at.toISOString() : row.started_at,
        ended_at: row.ended_at instanceof Date ? row.ended_at.toISOString() : row.ended_at,
        duration_secs: dur,
        call_successful: row.call_successful ?? pick(rp, ["analysis", "call_successful"]) ?? "",
        termination_reason: m.termination_reason ?? "",
        callback_requested: row.callback_requested ?? "",
        applicant_id: row.applicant_id ?? "",
      };
    });
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(CSV, [cols.join(","), ...rows.map((x) => cols.map((k) => csvCell(x[k])).join(","))].join("\n") + "\n");
    fs.writeFileSync(JSONF, JSON.stringify(rows, null, 2));

    // summary
    const total = rows.length;
    const byTerm = {}, byDir = {}, bySuccess = {}, callers = {};
    for (const x of rows) {
      byTerm[x.termination_reason || "(none)"] = (byTerm[x.termination_reason || "(none)"] || 0) + 1;
      byDir[x.direction || "(unknown)"] = (byDir[x.direction || "(unknown)"] || 0) + 1;
      bySuccess[x.call_successful || "(none)"] = (bySuccess[x.call_successful || "(none)"] || 0) + 1;
      if (x.caller_number) callers[x.caller_number] = (callers[x.caller_number] || 0) + 1;
    }
    console.log(`=== ${total} calls exported ===`);
    console.log(`  range: ${rows[0]?.created_at} → ${rows[total-1]?.created_at}`);
    console.log("  by direction:", JSON.stringify(byDir));
    console.log("  by termination:", JSON.stringify(byTerm));
    console.log("  by call_successful:", JSON.stringify(bySuccess));
    console.log("  distinct callers:", Object.keys(callers).length, JSON.stringify(callers));
    console.log(`  CSV : ${CSV}`);
    console.log(`  JSON: ${JSONF}`);
  } finally { await c.end(); }
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
