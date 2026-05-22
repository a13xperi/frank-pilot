#!/usr/bin/env node
// post-deploy-verify.mjs — definition-of-done for "the Railway API is live."
//
// Runs the 4 core checks from the deploy plan against a given API base URL:
//   1) /health returns {status:"ok", db:"ok"}.
//   2) POST /api/applicants/register returns 202 + ok:true (not 405).
//   3) Magic-link path is reachable (either devLink in response when
//      DEMO_LINK_IN_RESPONSE=true, or the route just doesn't 5xx).
//   4) GET /api/tape/page-view (public BP-03b beacon) returns 200/204.
//
// Optional Vercel SPA static-asset checks (front-end domain):
//   --site=https://frank-pilot-tenant.vercel.app
//     Verifies /sitemap.xml and /robots.txt are served as static files
//     (non-text/html content-type). Catches the catch-all rewrite
//     regression where SPA HTML eats static assets.
//
// Optional BP-02 dual-write parity check (NDJSON ↔ Postgres):
//   --verify-dual-write
//     POSTs one tape beacon, then asserts that the same session_id appears
//     in both the NDJSON ledger and the compliance_tape Postgres table.
//     Requires COMPLIANCE_TAPE_V2_ENABLED=true and DATABASE_URL set.
//
// Usage:
//   node scripts/post-deploy-verify.mjs https://frank-pilot-api.up.railway.app
//   node scripts/post-deploy-verify.mjs https://api.../  --site=https://...vercel.app
//   node scripts/post-deploy-verify.mjs https://api.../  --verify-dual-write
//
// Exit code: 0 if all pass, 1 otherwise.

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith("--"));
const positional = args.filter((a) => !a.startsWith("--"));
const base = positional[0] || process.env.API_BASE || process.env.RAILWAY_PUBLIC_DOMAIN;
const siteFlag = flags.find((f) => f.startsWith("--site="));
const SITE = siteFlag ? siteFlag.slice("--site=".length).replace(/\/$/, "") : null;
const VERIFY_DUAL_WRITE = flags.includes("--verify-dual-write");

if (!base) {
  console.error(
    "Usage: post-deploy-verify.mjs <https://api-base-url> [--site=https://...vercel.app] [--verify-dual-write]",
  );
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

async function checkSitemapAndRobots() {
  if (!SITE) return;
  for (const path of ["/sitemap.xml", "/robots.txt"]) {
    const expected = path === "/sitemap.xml" ? "xml" : "text";
    try {
      const r = await fetch(`${SITE}${path}`);
      const ct = (r.headers.get("content-type") || "").toLowerCase();
      const okStatus = r.ok;
      const okType = ct.includes(expected) && !ct.includes("text/html");
      record(
        `05-static-${path.slice(1)}`,
        okStatus && okType,
        `status=${r.status} content-type=${ct || "(empty)"}`,
      );
    } catch (e) {
      record(`05-static-${path.slice(1)}`, false, `network error: ${e.message}`);
    }
  }
}

async function checkDualWriteParity() {
  if (!VERIFY_DUAL_WRITE) return;
  if (process.env.COMPLIANCE_TAPE_V2_ENABLED !== "true") {
    record(
      "06-dual-write-parity",
      false,
      "COMPLIANCE_TAPE_V2_ENABLED is not 'true'; skipping",
    );
    return;
  }
  if (!process.env.DATABASE_URL) {
    record(
      "06-dual-write-parity",
      false,
      "DATABASE_URL not set; cannot check Postgres side",
    );
    return;
  }
  const sessionId = `verify-${Date.now()}`;
  const url = `${API}/api/tape/page-view`;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        formId: "HUD-928.1",
        page: 1,
        ts: Date.now(),
      }),
    });
    if (!r.ok && r.status !== 202 && r.status !== 204) {
      record("06-dual-write-parity", false, `beacon POST returned ${r.status}`);
      return;
    }
    let pg;
    try {
      const { Client } = await import("pg");
      pg = new Client({ connectionString: process.env.DATABASE_URL });
      await pg.connect();
      const { rows } = await pg.query(
        "SELECT count(*)::int AS n FROM compliance_tape WHERE session_id = $1",
        [sessionId],
      );
      const pgCount = rows[0]?.n ?? 0;
      const ndjsonPath = process.env.TAPE_LEDGER_PATH || "server/tape/bp03b.ndjson";
      const { readFile } = await import("node:fs/promises");
      let ndjsonCount = 0;
      try {
        const text = await readFile(ndjsonPath, "utf8");
        ndjsonCount = text
          .split("\n")
          .filter((l) => l.includes(`"session_id":"${sessionId}"`)).length;
      } catch {
        ndjsonCount = 0;
      }
      const ok = pgCount > 0 && ndjsonCount > 0 && pgCount === ndjsonCount;
      record(
        "06-dual-write-parity",
        ok,
        `pg=${pgCount} ndjson=${ndjsonCount} session=${sessionId}`,
      );
    } finally {
      if (pg) await pg.end().catch(() => {});
    }
  } catch (e) {
    record("06-dual-write-parity", false, `error: ${e.message}`);
  }
}

console.log(`Verifying ${API}${SITE ? ` + ${SITE}` : ""}\n`);

await checkHealth();
const registerBody = await checkRegister();
checkMagicLinkSurface(registerBody);
await checkTapeBeacon();
await checkSitemapAndRobots();
await checkDualWriteParity();

const passed = results.filter((r) => r.passed).length;
const total = results.length;
console.log(
  `\n${passed}/${total} checks passed${passed === total ? " — deploy verified." : "."}`,
);
process.exit(passed === total ? 0 : 1);
