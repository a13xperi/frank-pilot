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

async function signInViaDevMagicLink(page: Page, email: string): Promise<void> {
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
  // Lift it onto the page's request context so `page.request.get(...)` calls
  // are authenticated the same way the SPA's fetches are.
  const token = await page.evaluate(() => localStorage.getItem("frank_tenant_token"));
  if (token) {
    // BrowserContext-level so it applies to page.request.* too (the SPA reads
    // the token from localStorage, but page.request runs out-of-process and
    // needs the header lifted onto it explicitly).
    await page.context().setExtraHTTPHeaders({ Authorization: `Bearer ${token}` });
  }
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
