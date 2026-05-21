// Local QA for the welcome→apply handoff:
//   - unauth deep-link to /apply?step=intent renders Step 1 (gate works)
//   - handoff URL params (unitType / hh / income / amiTier) survive the redirect
//   - register → magic-link verify → Step 3 (Intent) prefilled from URL
//
// Requires the dev banner that surfaces the magic link, so this only runs
// against a dev backend. For prod use scripts/qa-apply-handoff-prod.mjs.
//
// Usage:
//   BASE=http://localhost:5174 node scripts/qa-apply-handoff.mjs
//
// Output: screenshots in $OUT (default /tmp/qa-apply-handoff).

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const OUT = process.env.OUT || '/tmp/qa-apply-handoff';
const BASE = process.env.BASE || 'http://localhost:5174';
const VP = { width: 1280, height: 900 };

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log('SHOT', name, '←', page.url());
}

function check(label, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + label);
}

const ctx = await browser.newContext({ viewport: VP });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGE ERROR', e.message.slice(0, 200)));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE ERR', m.text().slice(0, 200));
});

try {
  const handoffUrl = `${BASE}/apply?step=intent&unitType=2BR&propertyId=donna-louise-2&state=available&hh=2&income=42000&amiTier=80`;
  await page.goto(handoffUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
  await page.waitForTimeout(800);
  await shot(page, '01-deeplink-arrives');

  const bodyText1 = await page.locator('body').innerText();
  check('Step 1 (Register) rendered after gate',
    /create your account|email|register|sign up/i.test(bodyText1));
  check('Intent step UI is NOT shown', !/show me units/i.test(bodyText1));

  const url1 = new URL(page.url());
  check('unitType=2BR survives in URL', url1.searchParams.get('unitType') === '2BR');
  check('hh=2 survives in URL',          url1.searchParams.get('hh') === '2');
  check('income=42000 survives in URL',  url1.searchParams.get('income') === '42000');
  check('amiTier=80 survives in URL',    url1.searchParams.get('amiTier') === '80');
  console.log('URL after gate:', page.url());

  const email = `qa+${Date.now()}@example.com`;
  await page.locator('#firstName').fill('QA').catch(() => {});
  await page.locator('#lastName').fill('Bot').catch(() => {});
  const mail = page.locator('input[type="email"]').first();
  if (await mail.count()) await mail.fill(email);

  const ctas = page.locator('button:visible');
  const ctaCount = await ctas.count();
  let registerClicked = false;
  for (let i = 0; i < ctaCount; i++) {
    const t = (await ctas.nth(i).innerText()).trim().toLowerCase();
    if (/(continue|send|register|sign)/.test(t) && !/back/.test(t)) {
      await ctas.nth(i).click({ timeout: 3000 }).catch(() => {});
      registerClicked = true;
      break;
    }
  }
  console.log('register CTA clicked:', registerClicked);
  await page.waitForTimeout(2000);
  await shot(page, '02-after-register-submit');

  const devLink = page.locator('a[href*="token="]').first();
  const hasLink = await devLink.count();
  console.log('dev magic link count:', hasLink);
  if (hasLink) {
    const href = await devLink.getAttribute('href');
    console.log('magic link href:', href?.slice(0, 80) + '…');
    await Promise.all([
      page.waitForURL(/\/apply\?/, { timeout: 8000 }).catch(() => {}),
      devLink.click({ timeout: 3000 }).catch(() => {}),
    ]);
    await page.waitForTimeout(2000);
    await shot(page, '03-after-verify');

    const bodyText3 = await page.locator('body').innerText();
    check('Step 3 (Intent) rendered after verify', /show me units/i.test(bodyText3));
    check('Sage AMI verdict visible', /80% AMI|qualify/i.test(bodyText3));
    check('"2 BR" text visible (prefill)', /2\s*BR/i.test(bodyText3));

    const hhSize = await page.locator('select').first().inputValue().catch(() => '');
    console.log('household-size select value:', hhSize);
    check('household-size = 2 (intent prefill survives)', hhSize === '2');

    const twoBR = page.locator('button:has-text("2 BR")').first();
    const twoBRStyle = await twoBR.getAttribute('style').catch(() => '');
    console.log('2 BR style snippet:', (twoBRStyle || '').slice(0, 120));
    // HF.accent terracotta is rgb(201, 73, 42) / #C9492A
    check('2 BR tile is selected (terracotta border)',
      /rgb\(201,\s*73,\s*42\)|#C9492A/i.test(twoBRStyle || ''));
  } else {
    console.log('No dev magic link found — verify-step banner not surfaced (prod build?).');
  }
} finally {
  await ctx.close();
  await browser.close();
}
