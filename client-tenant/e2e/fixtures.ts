// Playwright fixtures for the Frank-Pilot tenant portal.
//
// Provides three pre-authenticated Page handles:
//   applicantPage         — fresh register + dev magic-link, parked at intent
//   seededApplicantPage   — applicantA@cdpc.test (already past claim), at checklist
//   agentPage             — agent@cdpc.test (staff), at /dashboard
//
// Also wires `afterEach` to drain the QA debug bundle (PNG + qaBuffer + rrweb)
// on any non-passing test — same shape as the camera button, but local disk only.

import { test as base, expect, type Page } from "@playwright/test";
import { drainQaBundle } from "./qaDrain";

type Fixtures = {
  applicantPage: Page;
  seededApplicantPage: Page;
  agentPage: Page;
};

// Worker-scoped token cache. POST /auth/magic-link/request is rate-limited
// per (ip, email) at 5/min (src/modules/auth/routes.ts), and several seeded
// specs sign the same applicant in (apply-checklist + apply-resume = 7 calls).
// Mint each identity's Bearer token once per worker, then inject it into later
// pages' localStorage instead of re-requesting a link (which 429s).
const tokenCache = new Map<string, string>();

// Lift the Bearer token onto the browser context so `page.request.*` calls are
// authenticated the same way the SPA's fetches are. Context-level headers apply
// to the page's APIRequestContext too (proven by apply-checklist.spec.ts).
async function liftToken(page: Page, token: string): Promise<void> {
  await page.context().setExtraHTTPHeaders({ Authorization: `Bearer ${token}` });
}

async function signInViaDevMagicLink(page: Page, email: string): Promise<string> {
  // Reuse a cached token when this worker has already minted one for `email`,
  // injecting it into localStorage so the SPA boots authenticated on the next
  // navigation — no second magic-link request (avoids the 5/min limiter).
  const cached = tokenCache.get(email);
  if (cached) {
    await page.addInitScript(
      (t) => localStorage.setItem("frank_tenant_token", t),
      cached,
    );
    await liftToken(page, cached);
    return cached;
  }

  // Dev backends return `devLink` in the magic-link response. We hit the API
  // directly via the page's request context so the cookie/origin matches the
  // browser session that will consume the link.
  const res = await page.request.post("/api/auth/magic-link/request", {
    data: { email },
  });
  expect(res.ok(), `magic-link/request failed (${res.status()})`).toBeTruthy();
  const body = (await res.json()) as { devLink?: string };
  if (!body.devLink) {
    throw new Error(
      `dev magic-link missing for ${email}; ensure NODE_ENV=development on the API.`
    );
  }
  const url = new URL(body.devLink);
  await page.goto(`/auth/callback${url.search}`);
  await page.waitForURL((u) => !u.pathname.startsWith("/auth/callback"), {
    timeout: 15_000,
  });
  // Auth token lives in localStorage (see client-tenant/src/api/client.ts).
  const token = await page.evaluate(() => localStorage.getItem("frank_tenant_token"));
  if (!token) {
    throw new Error(`no auth token in localStorage after magic-link verify for ${email}.`);
  }
  tokenCache.set(email, token);
  await liftToken(page, token);
  return token;
}

export const test = base.extend<Fixtures>({
  applicantPage: async ({ page }, use) => {
    const email = `qa+${Date.now()}@example.com`;
    await page.goto("/apply");
    await page.getByLabel(/email/i).first().fill(email);
    await page.getByLabel(/first name/i).fill("QA");
    await page.getByLabel(/last name/i).fill("Tester");
    // Submit and wait for the dev banner (devLink rendered on StepVerify).
    const reqWait = page.waitForResponse(
      (r) => r.url().includes("/applicants/register") && r.request().method() === "POST"
    );
    await page.getByRole("button", { name: /continue|submit|sign up|create/i }).click();
    const reg = await reqWait;
    const regBody = (await reg.json().catch(() => ({}))) as { devLink?: string };
    if (!regBody.devLink) {
      throw new Error("applicantPage: dev magic-link absent from register response");
    }
    const url = new URL(regBody.devLink);
    await page.goto(`/auth/callback${url.search}`);
    await page.waitForURL(/\/apply\?step=intent/, { timeout: 15_000 });
    // Lift the Bearer token (set in localStorage by the callback) onto the
    // context so this fixture's `page.request.*` calls are authenticated —
    // the register path doesn't go through signInViaDevMagicLink.
    const token = await page.evaluate(() =>
      localStorage.getItem("frank_tenant_token"),
    );
    if (token) await liftToken(page, token);
    await use(page);
  },

  seededApplicantPage: async ({ page }, use) => {
    await signInViaDevMagicLink(page, "applicantA@cdpc.test");
    // The seeded user is past intent + claim, so we deep-link straight to
    // the checklist step. StepChecklist hydrates from /applicants/me/applications.
    await page.goto("/apply?step=checklist");
    await use(page);
  },

  agentPage: async ({ page }, use) => {
    await signInViaDevMagicLink(page, "agent@cdpc.test");
    await page.waitForURL(/\/dashboard/, { timeout: 15_000 }).catch(() => {
      /* If routing differs (e.g. role-based redirect), let the test handle it. */
    });
    await use(page);
  },
});

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status !== "passed" && testInfo.status !== "skipped") {
    await drainQaBundle(page, testInfo).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      // Don't fail the test on a drain hiccup; the original failure stands.
      // eslint-disable-next-line no-console
      console.warn(`[qaDrain] ${msg}`);
    });
  }
});

export { expect };
