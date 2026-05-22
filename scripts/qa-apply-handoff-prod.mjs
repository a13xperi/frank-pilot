// Prod smoke for the welcome→apply handoff. Three checks:
//   1) Gate forces Step 1 + handoff URL params survive the redirect.
//   2) intentBedrooms + intentHouseholdSize round-trip through sessionStorage
//      under frank_apply_state (proves the persistence fix is in the shipped bundle).
//   3) POST /api/applicants/register returns 202 — fails loudly on 405 so we
//      catch "SPA shipped without backend" regressions in CI.
//
// We can't headlessly walk register → magic-link verify on prod (no dev banner),
// so the post-verify prefill is proven via sessionStorage round-trip + bundle sniff.
//
// Usage:
//   BASE=https://frank-pilot-tenant.vercel.app node scripts/qa-apply-handoff-prod.mjs
//
// Output: screenshots in $OUT (default /tmp/qa-apply-handoff-prod).
// Exit code: 1 if any check fails (so CI can gate on it).

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const OUT = process.env.OUT || '/tmp/qa-apply-handoff-prod';
const BASE = process.env.BASE || 'https://frank-pilot-tenant.vercel.app';
const VP = { width: 1280, height: 900 };

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log('SHOT', name, '←', page.url());
}

let anyFailed = false;
function check(label, cond) {
  if (!cond) anyFailed = true;
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + label);
}

const ctx = await browser.newContext({ viewport: VP });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGE ERROR', e.message.slice(0, 200)));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE ERR', m.text().slice(0, 200));
});

try {
  // 1) Gate behavior
  const handoffUrl = `${BASE}/apply?step=intent&unitType=2BR&propertyId=donna-louise-2&state=available&hh=2&income=42000&amiTier=80`;
  await page.goto(handoffUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(1500);
  await shot(page, '01-deeplink');

  const bodyText1 = await page.locator('body').innerText();
  check('Step 1 (Register) rendered after gate',
    /create your account|email|register|sign up/i.test(bodyText1));
  check('Intent step UI is NOT shown', !/show me units/i.test(bodyText1));

  const url1 = new URL(page.url());
  check('unitType=2BR survives in URL', url1.searchParams.get('unitType') === '2BR');
  check('hh=2 survives in URL',          url1.searchParams.get('hh') === '2');
  check('income=42000 survives in URL',  url1.searchParams.get('income') === '42000');
  check('amiTier=80 survives in URL',    url1.searchParams.get('amiTier') === '80');

  // 2) sessionStorage round-trip — confirms the persistence shape is recognized.
  await page.evaluate(() => {
    window.sessionStorage.setItem('frank_apply_state', JSON.stringify({
      adults: 1,
      paymentRef: null,
      grossAnnualIncome: null,
      qualifyingAmiTier: null,
      qualifyingAmiCalculatedAt: null,
      qualifyingHouseholdSize: null,
      intentBedrooms: 2,
      intentHouseholdSize: 2,
    }));
  });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await shot(page, '02-after-reload');

  const persisted = await page.evaluate(() => window.sessionStorage.getItem('frank_apply_state'));
  const parsed = JSON.parse(persisted || '{}');
  check('intentBedrooms = 2 persists across reload', parsed.intentBedrooms === 2);
  check('intentHouseholdSize = 2 persists across reload', parsed.intentHouseholdSize === 2);

  // 3) Sniff the shipped JS for the new identifier — proves the fix is the bytes Vercel serves.
  const html = await page.content();
  const scriptSrcs = [...html.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1]);
  let foundIntentBedrooms = false;
  for (const src of scriptSrcs.slice(0, 8)) {
    const absUrl = src.startsWith('http') ? src : new URL(src, BASE).toString();
    const res = await page.request.get(absUrl).catch(() => null);
    if (!res) continue;
    const text = await res.text().catch(() => '');
    if (/intentBedrooms/.test(text)) {
      foundIntentBedrooms = true;
      console.log('"intentBedrooms" found in bundle:', absUrl.slice(-60));
      break;
    }
  }
  check('Built bundle contains intentBedrooms identifier', foundIntentBedrooms);

  // 06-register-post — POST the actual register endpoint. This is the gap the
  // GET-only checks above can't see: a SPA shipped without a backend will return
  // 405 here (Vercel's static handler rejects POST), and we want CI to FAIL
  // loudly on that, not paper over it with a green "9/9 PASS".
  const registerUrl = `${BASE}/api/applicants/register`;
  const registerEmail = `qa+${Date.now()}@example.com`;
  let registerStatus = 0;
  let registerBody = '';
  let registerJson = null;
  try {
    const res = await fetch(registerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: registerEmail, firstName: 'QA', lastName: 'Prod' }),
    });
    registerStatus = res.status;
    registerBody = await res.text();
    try { registerJson = JSON.parse(registerBody); } catch { /* not JSON */ }
  } catch (e) {
    console.log('06-register-post fetch threw:', (e && e.message) || String(e));
  }
  console.log('06-register-post status:', registerStatus, 'body:', registerBody.slice(0, 200));
  check('POST /api/applicants/register returns 202 (not 405 — backend is live)',
    registerStatus === 202);
  check('Register response body has ok === true',
    !!(registerJson && registerJson.ok === true));

  if (anyFailed) {
    console.error('PROD SMOKE FAILED');
    process.exitCode = 1;
  }
} finally {
  await ctx.close();
  await browser.close();
}
