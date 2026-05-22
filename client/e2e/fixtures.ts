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
//   seniorPage — senior@cdpc.test (senior_manager — sees most pages)
//   adminPage  — admin@cdpc.test  (system_admin — sees everything)
//   agentPage  — agent@cdpc.test  (leasing_agent — most restricted)

import { test as base, expect, type Page } from "@playwright/test";

const PASSWORD = "password123";
const TOKEN_KEY = "frank_token";
const USER_KEY = "frank_user";

type Fixtures = {
  seniorPage: Page;
  adminPage: Page;
  agentPage: Page;
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
 * stage) via the admin-only seed endpoint. Used by tests that need populated
 * tables — the base seed only creates a single application.
 */
export async function seedDemoData(page: Page): Promise<void> {
  const res = await page.request.post("/api/demo/seed");
  expect(
    res.ok(),
    `demo seed failed (${res.status()}) — must be authenticated as system_admin`
  ).toBeTruthy();
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
});

export { expect };
