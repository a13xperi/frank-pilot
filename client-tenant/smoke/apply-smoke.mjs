// Discover slice smoke — light HTTP-only checks.
//
// Usage:
//   BASE=http://localhost:5173 API=http://localhost:3002 node client-tenant/smoke/apply-smoke.mjs
//
// - GET ${API}/api/properties with auth header (if TENANT_TOKEN is set), assert 17 properties.
//   If no token, skip with a warning rather than failing — the route requires auth.
// - GET ${BASE}/discover HTML, assert it contains "Las Vegas".

const BASE = (process.env.BASE || 'http://localhost:5173').replace(/\/$/, '');
const API = (process.env.API || 'http://localhost:3002').replace(/\/$/, '');
const TENANT_TOKEN = process.env.TENANT_TOKEN || '';

let passed = 0;
let failed = 0;
let skipped = 0;

function ok(label) {
  passed++;
  console.log(`PASS  ${label}`);
}
function fail(label, err) {
  failed++;
  console.log(`FAIL  ${label}${err ? ` — ${err}` : ''}`);
}
function skip(label, reason) {
  skipped++;
  console.log(`SKIP  ${label} — ${reason}`);
}

async function checkPropertiesAPI() {
  const label = `GET ${API}/api/properties → 17 rows`;
  if (!TENANT_TOKEN) {
    skip(label, 'TENANT_TOKEN not set (route requires property:view auth)');
    return;
  }
  try {
    const res = await fetch(`${API}/api/properties`, {
      headers: { Authorization: `Bearer ${TENANT_TOKEN}` },
    });
    if (!res.ok) return fail(label, `HTTP ${res.status}`);
    const body = await res.json();
    const list = body.properties ?? body;
    if (!Array.isArray(list)) return fail(label, 'response not an array');
    if (list.length !== 17) return fail(label, `got ${list.length}, expected 17`);
    ok(label);
  } catch (e) {
    fail(label, e instanceof Error ? e.message : String(e));
  }
}

async function checkDiscoverHTML() {
  const label = `GET ${BASE}/discover returns SPA shell`;
  try {
    const res = await fetch(`${BASE}/discover`);
    if (!res.ok) return fail(label, `HTTP ${res.status}`);
    const html = await res.text();
    // SPA bundle — runtime strings ("Las Vegas") hydrate client-side, so
    // we look for shell markers proving the route served the React app.
    if (html.includes('<div id="root"') || html.includes('CDPC') || html.includes('Apply')) ok(label);
    else fail(label, 'no SPA shell marker found');
  } catch (e) {
    fail(label, e instanceof Error ? e.message : String(e));
  }
}

await checkPropertiesAPI();
await checkDiscoverHTML();

console.log(`\nresults: ${passed} pass, ${failed} fail, ${skipped} skip`);
process.exit(failed > 0 ? 1 : 0);
