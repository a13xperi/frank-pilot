// Local QA for the welcome→apply handoff:
//   - unauth deep-link to /apply?step=intent renders Step 1 (gate works)
//   - handoff URL params (unitType / hh / income / amiTier) survive the redirect
//   - register → magic-link verify → Step 3 (Intent) prefilled from URL
//   - Step 3 → Step 4 (Checklist) → Step 5 (Pick) → Step 6 (Claim)
//     covers the wedge point where the wizard branches (PR #40 / FROZEN CONTRACT 5).
//
//     Step 6 (Claim) requires a unit in the dev DB matching the user's intent.
//     If none exist, that assertion is reported as SKIP, not FAIL — the Vitest
//     integration test (Apply.integration.test.tsx) covers Step 6 with mocked
//     data and is the canonical regression net for the wedge.
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
function skip(label, reason) {
  console.log('SKIP  ' + label + (reason ? ` — ${reason}` : ''));
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

    // Step 3 → 4: fill required move-in date, then submit intent → checklist
    const moveIn = page.getByLabel(/target move-in/i).first();
    if (await moveIn.count()) {
      await moveIn.fill('2026-09-01').catch(() => {});
    }
    const showUnits = page.getByRole('button', { name: /show me units/i }).first();
    await showUnits.click({ timeout: 4000 }).catch(() => {});

    await page
      .getByRole('heading', { name: /before you apply/i })
      .first()
      .waitFor({ timeout: 8000 })
      .catch(() => {});
    await shot(page, '04-checklist');

    // URL flips to ?step=checklist when the intent POST resolves — use the URL
    // as the source of truth. The step-indicator sidebar prints every step
    // label, so body innerText alone is unreliable for "are we on this step?".
    check('URL advanced to step=checklist',
      /step=checklist/.test(page.url()));
    const bodyText4 = await page.locator('body').innerText();
    check('Checklist mentions $35.95 fee', /\$35\.95/.test(bodyText4));
    check('Checklist mentions 120 days rule', /120[-\s]?days?/i.test(bodyText4));
    check('Checklist "Application fee" callout', /application fee/i.test(bodyText4));

    // Step 4 → 5: "I have these — continue" CTA
    const checklistContinue = page
      .locator('button:visible')
      .filter({ hasText: /i have these.*continue|^continue$/i })
      .first();
    await checklistContinue.click({ timeout: 4000 }).catch(() => {});

    await page
      .getByRole('heading', { name: /pick your unit/i })
      .first()
      .waitFor({ timeout: 8000 })
      .catch(() => {});
    await shot(page, '05-pick');

    check('URL advanced to step=pick', /step=pick/.test(page.url()));

    const claimBtns = page.locator('button:visible:has-text("Claim this unit")');
    const claimCount = await claimBtns.count();
    console.log('claim button count:', claimCount);

    if (claimCount > 0) {
      check('At least one available unit to claim', true);
      // Step 5 → 6: claim → confirmation
      await claimBtns.first().click({ timeout: 4000 }).catch(() => {});
      await page
        .getByRole('heading', { name: /is yours$/i })
        .first()
        .waitFor({ timeout: 8000 })
        .catch(() => {});
      await shot(page, '06-claim');

      check('URL advanced to step=claim', /step=claim/.test(page.url()));
      const bodyText6 = await page.locator('body').innerText();
      check('Step 6 (Claim) shows "Unit … is yours" heading',
        /unit\s+\S+\s+is yours/i.test(bodyText6));
      check('"Continue your application" CTA visible on claim step',
        /continue your application/i.test(bodyText6));
    } else {
      // Empty state — dev DB has no units matching the prefilled intent.
      // The "No units match…" empty-state is itself a valid UX state to
      // assert; the canonical claim-flow regression net is the Vitest
      // integration test (Apply.integration.test.tsx).
      const bodyText5 = await page.locator('body').innerText();
      check('Step 5 empty-state messaging visible',
        /no units match|adjust your search/i.test(bodyText5));
      skip('Step 6 (Claim) reachable', 'no units match dev DB — covered by Vitest integration test');
    }
  } else {
    console.log('No dev magic link found — verify-step banner not surfaced (prod build?).');
  }
} finally {
  await ctx.close();
  await browser.close();
}
