#!/usr/bin/env node
// voice-intake-smoke.mjs — end-to-end smoke for the ElevenLabs post-call webhook.
//
// Sends a CORRECTLY-SIGNED synthetic `post_call_transcription` payload to the
// live webhook exactly the way ElevenLabs signs it
//   HMAC-SHA256(secret, "<ts>." + rawBody)  →  header  ElevenLabs-Signature: t=<ts>,v0=<hex>
// (the scheme is unit-pinned in src/__tests__/voice-intake-webhook.test.ts and
//  verified by src/modules/voice-intake/signature.ts::verifySignature), then
// asserts the webhook accepts it (200 {received:true}). Optionally connects to
// the DB and confirms the row actually landed in voice_intake_calls.
//
// This is the pre-/post-flip companion to the "one real call to 725" check
// (ADI-209 / IN-2): it exercises the signed-payload → row path WITHOUT a phone
// call, so you can prove the pipe the moment VOICE_INTAKE_ENABLED flips.
//
// Usage:
//   ELEVENLABS_WEBHOOK_SECRET=wsec_real \
//     node scripts/voice-intake-smoke.mjs https://frank-pilot-api.up.railway.app
//
//   # also confirm the row landed (and remove the smoke row afterward):
//   ELEVENLABS_WEBHOOK_SECRET=wsec_real DATABASE_URL=postgres://... \
//     node scripts/voice-intake-smoke.mjs https://api.../ --verify-row --cleanup
//
//   # offline: just print the signed header for a payload (no network):
//   ELEVENLABS_WEBHOOK_SECRET=wsec_real node scripts/voice-intake-smoke.mjs --print-only
//
// Flags:
//   --verify-row   after the POST, SELECT the conversation from voice_intake_calls
//                  (requires DATABASE_URL). Confirms the write actually persisted.
//   --cleanup      with --verify-row, DELETE the synthetic smoke row afterward so
//                  prod is left pristine. (Smoke rows are tagged conv_SMOKE_<ts>.)
//   --print-only   sign a payload and print the curl-ready header + body; no POST.
//   --agent=<id>   override the agent_id in the payload.
//
// Exit code: 0 if every check passes, 1 otherwise, 2 on usage/secret error.

import crypto from "node:crypto";

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith("--"));
const positional = args.filter((a) => !a.startsWith("--"));
const VERIFY_ROW = flags.includes("--verify-row");
const CLEANUP = flags.includes("--cleanup");
const PRINT_ONLY = flags.includes("--print-only");
const agentFlag = flags.find((f) => f.startsWith("--agent="));
const AGENT_ID = agentFlag
  ? agentFlag.slice("--agent=".length)
  : "agent_8001ksp9ar8cf8ct2x70kacxr8qq";

const SECRET = process.env.ELEVENLABS_WEBHOOK_SECRET;
if (!SECRET || SECRET === "wsec_changeme") {
  console.error(
    "ELEVENLABS_WEBHOOK_SECRET must be set to the REAL webhook secret " +
      "(the sentinel 'wsec_changeme' is rejected fail-closed by the webhook).",
  );
  process.exit(2);
}

const base = positional[0] || process.env.API_BASE || process.env.RAILWAY_PUBLIC_DOMAIN;
if (!base && !PRINT_ONLY) {
  console.error(
    "Usage: voice-intake-smoke.mjs <https://api-base-url> [--verify-row] [--cleanup] [--agent=<id>]\n" +
      "       voice-intake-smoke.mjs --print-only",
  );
  process.exit(2);
}
const API = base ? base.replace(/\/$/, "") : null;

// ── Build + sign the payload (mirrors ElevenLabs + the webhook test fixture) ──
const ts = Math.floor(Date.now() / 1000);
const convId = `conv_SMOKE_${ts}`;
const payload = {
  type: "post_call_transcription",
  event_timestamp: ts,
  data: {
    conversation_id: convId,
    agent_id: AGENT_ID,
    status: "done",
    metadata: {
      start_time_unix_secs: ts,
      call_duration_secs: 42,
      detected_language: "en",
      cost: { llm_input_tokens: 100 },
    },
    analysis: {
      call_successful: "success",
      evaluation_criteria_results: { name: { result: "success" } },
      data_collection_results: {
        name: { value: "Smoke Test" },
        phone: { value: "+17025550000" },
        current_city: { value: "Las Vegas" },
      },
    },
  },
};
const body = JSON.stringify(payload);
const sig = crypto
  .createHmac("sha256", SECRET)
  .update(`${ts}.`)
  .update(body, "utf8")
  .digest("hex");
const sigHeader = `t=${ts},v0=${sig}`;

if (PRINT_ONLY) {
  console.log(`# signed post-call payload (conversation_id=${convId})`);
  console.log(`# header:`);
  console.log(`ElevenLabs-Signature: ${sigHeader}`);
  console.log(`# body:`);
  console.log(body);
  process.exit(0);
}

const results = [];
function record(name, passed, detail) {
  results.push({ passed });
  const tag = passed ? "\x1b[1;32mPASS\x1b[0m" : "\x1b[1;31mFAIL\x1b[0m";
  console.log(`${tag} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function postWebhook() {
  const url = `${API}/api/webhooks/elevenlabs/post-call`;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "ElevenLabs-Signature": sigHeader,
      },
      body,
    });
    const json = await r.json().catch(() => ({}));
    const ok = r.status === 200 && json.received === true;
    record(
      "01-webhook-accepts-signed-payload",
      ok,
      `status=${r.status} body=${JSON.stringify(json)} conv=${convId}`,
    );
    return ok;
  } catch (e) {
    record("01-webhook-accepts-signed-payload", false, `network error: ${e.message}`);
    return false;
  }
}

async function verifyRow() {
  if (!VERIFY_ROW) return;
  if (!process.env.DATABASE_URL) {
    record("02-row-persisted", false, "DATABASE_URL not set; cannot check the DB side");
    return;
  }
  let pg;
  try {
    const { Client } = await import("pg");
    pg = new Client({ connectionString: process.env.DATABASE_URL });
    await pg.connect();
    const { rows } = await pg.query(
      "SELECT conversation_id, agent_id, call_successful, started_at FROM voice_intake_calls WHERE conversation_id = $1",
      [convId],
    );
    const ok = rows.length === 1;
    record(
      "02-row-persisted",
      ok,
      ok ? `voice_intake_calls row present (agent=${rows[0].agent_id})` : "row NOT found",
    );
    if (ok && CLEANUP) {
      await pg.query("DELETE FROM voice_intake_calls WHERE conversation_id = $1", [convId]);
      await pg
        .query("DELETE FROM elevenlabs_processed_events WHERE event_id LIKE $1", [`%${convId}%`])
        .catch(() => {});
      console.log(`       cleaned up smoke row ${convId}`);
    } else if (ok) {
      console.log(`       smoke row left in place — safe to delete: conversation_id='${convId}'`);
    }
  } catch (e) {
    record("02-row-persisted", false, `db error: ${e.message}`);
  } finally {
    if (pg) await pg.end().catch(() => {});
  }
}

console.log(`Smoke-testing voice-intake webhook at ${API}\n`);
await postWebhook();
await verifyRow();

const passed = results.filter((r) => r.passed).length;
const total = results.length;
console.log(`\n${passed}/${total} checks passed${passed === total ? " — webhook pipe verified." : "."}`);
process.exit(passed === total ? 0 : 1);
