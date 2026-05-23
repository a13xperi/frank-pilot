import { defineConfig, devices } from "@playwright/test";

// Playwright harness for the PM / staff console ("CDPC Compliance Hub").
//
// Two web servers are booted (both idempotent via reuseExistingServer):
//   1. The full backend stack — Docker/local Postgres + migrate + seed + the
//      Express API on :3002 — via the repo-root `npm run e2e:up`. We probe the
//      API's /health rather than the tenant vite it also starts, so this app's
//      harness doesn't depend on the sibling tenant build.
//   2. This console's Vite dev server on :5176 (proxies /api -> :3002). We pick
//      5176 so it coexists with a normal `npm run dev` (:5173) and the tenant
//      e2e harness (:5175).
//
// Override the base URL with E2E_BASE_URL to point at a deployed environment.

const VITE_PORT = Number(process.env.PM_VITE_PORT ?? 5176);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${VITE_PORT}`;
const API_HEALTH = process.env.E2E_API_HEALTH ?? "http://127.0.0.1:3002/health";

export default defineConfig({
  testDir: "./e2e/scenarios",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false, // tests share one DB; serial avoids race conditions
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // Skip server boot when pointing at a deployed environment.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        {
          command: "npm run e2e:up",
          cwd: "..",
          url: API_HEALTH,
          reuseExistingServer: true,
          timeout: 180_000,
          stdout: "pipe",
          stderr: "pipe",
        },
        {
          command: `npm run dev -- --port ${VITE_PORT} --host 127.0.0.1`,
          url: BASE_URL,
          reuseExistingServer: true,
          timeout: 60_000,
          stdout: "pipe",
          stderr: "pipe",
        },
      ],
});
