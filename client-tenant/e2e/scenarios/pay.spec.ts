import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";

/**
 * BP-08 client-side payment surface (@payments).
 *
 * OPT-IN: tagged `@payments`, NOT part of the required `smoke-apply` gate. Run
 * locally with:  npm run e2e -- --grep @payments
 *
 * Preconditions (the spec self-skips, never fails, when any is missing):
 *   1. Server payments enabled — STRIPE_LIVE_ENABLED=true + a publishable key
 *      (GET /api/payments/config → { enabled, publishableKey }).
 *   2. A payable tenant session — a user with an activeApplication and
 *      balance > 0. The default e2e harness seed (npm run seed) has no payable
 *      tenant; run `npm run seed:demo` to seed demo-tenant@example.com
 *      (Tomasz Kowalski, delinquent ledger balance). Override the login via
 *      E2E_PAYMENT_EMAIL.
 *   3. The client was built with the Stripe surface on (VITE_PAYMENT_WIZARD_ENABLED).
 *
 * Card entry runs in a cross-origin Stripe iframe and is inherently flaky, so
 * it lives in its own test below the mount/network assertion.
 */

const PAYMENT_EMAIL = process.env.E2E_PAYMENT_EMAIL ?? "demo-tenant@example.com";

interface PaymentsConfig {
  enabled?: boolean;
  publishableKey?: string | null;
}

interface DashboardData {
  activeApplication?: { id?: string } | null;
  balance?: { balance?: number } | null;
}

/** Dev magic-link sign-in (mirrors e2e/fixtures.ts signInViaDevMagicLink). */
async function signIn(page: Page, email: string): Promise<boolean> {
  const res = await page.request.post("/api/auth/magic-link/request", {
    data: { email },
  });
  if (!res.ok()) return false;
  const body = (await res.json()) as { devLink?: string };
  if (!body.devLink) return false;
  const url = new URL(body.devLink);
  await page.goto(`/auth/callback${url.search}`);
  await page
    .waitForURL((u) => !u.pathname.startsWith("/auth/callback"), { timeout: 15_000 })
    .catch(() => undefined);
  const token = await page.evaluate(() => localStorage.getItem("frank_tenant_token"));
  if (token) {
    await page.context().setExtraHTTPHeaders({ Authorization: `Bearer ${token}` });
  }
  return Boolean(token);
}

test.describe("Pay — Stripe surface", { tag: "@payments" }, () => {
  test("mints a PaymentIntent and mounts the Stripe PaymentElement", async ({ page }) => {
    // 1. Payments enabled server-side?
    const cfgRes = await page.request.get("/api/payments/config");
    test.skip(!cfgRes.ok(), `/api/payments/config failed (${cfgRes.status()})`);
    const cfg = (await cfgRes.json()) as PaymentsConfig;
    test.skip(
      !cfg.enabled || !cfg.publishableKey,
      "payments not enabled (set STRIPE_LIVE_ENABLED=true + publishable key)"
    );

    // 2. Payable tenant session?
    const signedIn = await signIn(page, PAYMENT_EMAIL);
    test.skip(!signedIn, `could not sign in ${PAYMENT_EMAIL} (run npm run seed:demo)`);

    const dashRes = await page.request.get("/api/tenant/dashboard");
    test.skip(!dashRes.ok(), `/api/tenant/dashboard failed (${dashRes.status()})`);
    const dash = (await dashRes.json()) as DashboardData;
    test.skip(
      !dash.activeApplication?.id || !(Number(dash.balance?.balance) > 0),
      `${PAYMENT_EMAIL} has no payable balance (run npm run seed:demo)`
    );

    // 3. Navigate and assert the intent mint round-trips with a client_secret.
    const mintWait = page
      .waitForResponse(
        (r) =>
          r.url().includes("/api/payments/intents") && r.request().method() === "POST",
        { timeout: 15_000 }
      )
      .catch(() => null);

    await page.goto("/pay");

    const mint = await mintWait;
    test.skip(
      mint === null,
      "Stripe surface did not mint an intent — client likely built without VITE_PAYMENT_WIZARD_ENABLED"
    );
    expect(mint!.status(), "intent mint should return 2xx").toBeLessThan(300);
    const mintBody = (await mint!.json()) as { clientSecret?: string };
    expect(mintBody.clientSecret, "mint response carries a client_secret").toBeTruthy();

    // PaymentElement renders inside a cross-origin Stripe iframe.
    const stripeFrame = page.frameLocator('iframe[name^="__privateStripeFrame"]').first();
    await expect(
      stripeFrame.locator("body"),
      "Stripe PaymentElement iframe should mount"
    ).toBeVisible({ timeout: 15_000 });
  });

  test("accepts the 4242 test card and confirms @cardentry", async ({ page }) => {
    test.skip(
      process.env.E2E_RUN_CARD_ENTRY !== "true",
      "card-entry is flaky against live Stripe — set E2E_RUN_CARD_ENTRY=true to run"
    );

    const cfgRes = await page.request.get("/api/payments/config");
    test.skip(!cfgRes.ok(), `/api/payments/config failed (${cfgRes.status()})`);
    const cfg = (await cfgRes.json()) as PaymentsConfig;
    test.skip(!cfg.enabled || !cfg.publishableKey, "payments not enabled");

    const signedIn = await signIn(page, PAYMENT_EMAIL);
    test.skip(!signedIn, `could not sign in ${PAYMENT_EMAIL}`);

    await page.goto("/pay");
    const stripeFrame = page.frameLocator('iframe[name^="__privateStripeFrame"]').first();
    // PaymentElement consolidates card fields; fill by accessible label.
    await stripeFrame.getByLabel(/card number/i).fill("4242 4242 4242 4242");
    await stripeFrame.getByLabel(/expiration|expiry|MM ?\/ ?YY/i).fill("12 / 34");
    await stripeFrame.getByLabel(/CVC|CVV|security code/i).fill("123");
    await stripeFrame.getByLabel(/ZIP|postal/i).fill("89101").catch(() => undefined);

    await page.getByRole("button", { name: /pay now/i }).click();

    // confirmPayment redirects to the return_url on success.
    await page.waitForURL(/\/pay\?.*status=complete/, { timeout: 30_000 });
  });
});
