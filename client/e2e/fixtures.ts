// Playwright fixtures for the Frank-Pilot PM / staff console.
//
// Auth here is email + password (POST /api/auth/login → { token, user }),
// unlike the tenant portal's magic-link flow. We sign in via the page's
// request context, then plant the same localStorage keys the SPA reads
// (frank_token / frank_user — see client/src/context/AuthContext.tsx) so the
// app boots already authenticated. The bearer token is also lifted onto the
// browser context so `page.request.*` calls in tests are authenticated.
//
// Pre-authenticated page handles, one per seeded role:
//   agentPage    — agent@cdpc.test    (leasing_agent    — most restricted)
//   seniorPage   — senior@cdpc.test   (senior_manager   — lifecycle pages)
//   regionalPage — regional@cdpc.test (regional_manager — tier2 + compliance)
//   assetPage    — asset@cdpc.test    (asset_manager    — tier3 + properties)
//   adminPage    — admin@cdpc.test    (system_admin     — sees everything)
//
// Each role fixture wraps the same underlying `page`, so a single test should
// use exactly one role. Tests that need seeded data first call `seedDemo` in a
// `beforeEach` — it seeds through a throwaway admin context, independent of the
// role page under test, so the role page stays the only thing touching `page`.

import { test as base, expect, type Browser, type Page } from "@playwright/test";

const PASSWORD = "password123";
const TOKEN_KEY = "frank_token";
const USER_KEY = "frank_user";

// True only when the suite is pointed at a *remote* deployed environment.
// Mutating specs import this and `test.skip(SKIP_WRITES, …)` so prod-targeted
// runs stay strictly read-only — no seeding, no status transitions on a live DB.
//
// E2E_BASE_URL pulls double duty: CI also sets it (to a localhost Vite) purely so
// playwright.config skips its own `e2e:up` webServer boot. A localhost target is
// always an ephemeral CI/local DB, so writes are safe there; only a non-localhost
// host (e.g. *.vercel.app) flips read-only. This keeps the safety property — any
// real deployment is read-only — without disabling write coverage in CI.
function isRemoteTarget(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const { hostname } = new URL(url);
    return !["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(hostname);
  } catch {
    return false;
  }
}

export const SKIP_WRITES = isRemoteTarget(process.env.E2E_BASE_URL);

type Fixtures = {
  seniorPage: Page;
  adminPage: Page;
  agentPage: Page;
  regionalPage: Page;
  assetPage: Page;
};

interface LoginResult {
  token: string;
  user: Record<string, unknown>;
}

/**
 * Authenticate `page` as `email` and return it parked at the dashboard ("/").
 * Plants frank_token/frank_user in localStorage so the SPA's AuthProvider
 * hydrates without a round-trip through the login form.
 */
export async function signIn(page: Page, email: string): Promise<LoginResult> {
  const res = await page.request.post("/api/auth/login", {
    data: { email, password: PASSWORD },
  });
  expect(
    res.ok(),
    `login failed for ${email} (${res.status()}) — is the API seeded?`
  ).toBeTruthy();
  const body = (await res.json()) as LoginResult;
  if (!body.token || !body.user) {
    throw new Error(`login response missing token/user for ${email}`);
  }

  // Establish the origin before touching localStorage, then seed the keys and
  // reload so AuthProvider picks them up on mount.
  await page.goto("/login");
  await page.evaluate(
    ({ token, user, tokenKey, userKey }) => {
      localStorage.setItem(tokenKey, token);
      localStorage.setItem(userKey, JSON.stringify(user));
    },
    { token: body.token, user: body.user, tokenKey: TOKEN_KEY, userKey: USER_KEY }
  );
  await page.context().setExtraHTTPHeaders({ Authorization: `Bearer ${body.token}` });
  await page.goto("/");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15_000 });
  return body;
}

/**
 * Idempotently load the rich demo dataset (applications across every pipeline
 * stage + work orders) via the admin-only seed endpoint. Used by tests that
 * need populated tables — the base seed only creates a single application.
 */
export async function seedDemoData(page: Page): Promise<void> {
  const res = await page.request.post("/api/demo/seed");
  expect(
    res.ok(),
    `demo seed failed (${res.status()}) — must be authenticated as system_admin`
  ).toBeTruthy();
}

/**
 * Seed the demo dataset through a throwaway system_admin context, isolated from
 * whatever role page the test uses. No-ops when SKIP_WRITES is set so prod runs
 * never mutate a live DB. Call from `beforeEach`.
 */
export async function seedDemo(browser: Browser, baseURL?: string): Promise<void> {
  if (SKIP_WRITES) return;
  const ctx = await browser.newContext({ baseURL });
  try {
    const page = await ctx.newPage();
    await signIn(page, "admin@cdpc.test");
    await seedDemoData(page);
  } finally {
    await ctx.close();
  }
}

export const test = base.extend<Fixtures>({
  seniorPage: async ({ page }, use) => {
    await signIn(page, "senior@cdpc.test");
    await use(page);
  },
  adminPage: async ({ page }, use) => {
    await signIn(page, "admin@cdpc.test");
    await use(page);
  },
  agentPage: async ({ page }, use) => {
    await signIn(page, "agent@cdpc.test");
    await use(page);
  },
  regionalPage: async ({ page }, use) => {
    await signIn(page, "regional@cdpc.test");
    await use(page);
  },
  assetPage: async ({ page }, use) => {
    await signIn(page, "asset@cdpc.test");
    await use(page);
  },
});

export { expect };
