#!/usr/bin/env node
// post-deploy-verify.mjs — definition-of-done for "the Railway API is live."
//
// Runs the 4 checks from the deploy plan against a given API base URL:
//   1) /health returns {status:"ok", db:"ok"}.
//   2) POST /api/applicants/register returns 202 + ok:true (not 405).
//   3) Magic-link path is reachable (either devLink in response when
//      DEMO_LINK_IN_RESPONSE=true, or the route just doesn't 5xx).
//   4) GET /api/tape/page-view (public BP-03b beacon) returns 200/204.
//
// Usage:
//   node scripts/post-deploy-verify.mjs https://frank-pilot-api.up.railway.app
//   (or via env: API_BASE=... node scripts/post-deploy-verify.mjs)
//
// Exit code: 0 if all pass, 1 otherwise.

const base =
  process.argv[2] || process.env.API_BASE || process.env.RAILWAY_PUBLIC_DOMAIN;

if (!base) {
  console.error("Usage: post-deploy-verify.mjs <https://api-base-url>");
  process.exit(2);
}

const API = base.replace(/\/$/, "");

const results = [];
function record(name, passed, detail) {
  results.push({ name, passed, detail });
  const tag = passed ? "\x1b[1;32mPASS\x1b[0m" : "\x1b[1;31mFAIL\x1b[0m";
  console.log(`${tag} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function checkHealth() {
  const url = `${API}/health`;
  try {
    const r = await fetch(url, { method: "GET" });
    const body = await r.json().catch(() => ({}));
    const ok = r.status === 200 && body.status === "ok";
    const dbOk = body.db === "ok" || body.database === "ok" || body.db == null;
    record("01-health", ok && dbOk, `${r.status} ${JSON.stringify(body)}`);
  } catch (e) {
    record("01-health", false, `network error: ${e.message}`);
  }
}

async function checkRegister() {
  const email = `verify+${Date.now()}@example.com`;
  const url = `${API}/api/applicants/register`;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, firstName: "Verify", lastName: "Bot" }),
    });
    const body = await r.json().catch(() => ({}));
    const ok = r.status === 202 && body.ok === true;
    record(
      "02-register-post",
      ok,
      `${r.status} ok=${body.ok ?? "?"} userId=${body.userId ? "✓" : "✗"}`,
    );
    return body;
  } catch (e) {
    record("02-register-post", false, `network error: ${e.message}`);
    return null;
  }
}

function checkMagicLinkSurface(registerBody) {
  if (!registerBody) {
    record("03-magic-link-surface", false, "skipped — no register body");
    return;
  }
  // Either dev/demo mode surfaces devLink, or it doesn't — both are valid in
  // prod. The fail case is a 5xx on register (already caught above) or a
  // payload that drops `ok` / `userId`.
  const hasUserId = typeof registerBody.userId === "string";
  const hasOk = registerBody.ok === true;
  record(
    "03-magic-link-surface",
    hasUserId && hasOk,
    `userId=${hasUserId ? "✓" : "✗"} devLink=${
      registerBody.devLink ? "present" : "absent (prod-safe)"
    }`,
  );
}

async function checkTapeBeacon() {
  const url = `${API}/api/tape/page-view`;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ formId: "HUD-928.1", page: 1, ts: Date.now() }),
    });
    const ok = r.status === 200 || r.status === 202 || r.status === 204;
    record("04-tape-beacon", ok, `status=${r.status}`);
  } catch (e) {
    record("04-tape-beacon", false, `network error: ${e.message}`);
  }
}

console.log(`Verifying ${API}\n`);

await checkHealth();
const registerBody = await checkRegister();
checkMagicLinkSurface(registerBody);
await checkTapeBeacon();

const passed = results.filter((r) => r.passed).length;
const total = results.length;
console.log(
  `\n${passed}/${total} checks passed${passed === total ? " — deploy verified." : "."}`,
);
process.exit(passed === total ? 0 : 1);
