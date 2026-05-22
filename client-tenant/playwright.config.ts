import { defineConfig, devices } from "@playwright/test";

// Single source of truth for the Playwright harness. Boots the full stack
// via `npm run e2e:up` at the repo root (idempotent — reuses existing
// dev servers via reuseExistingServer:true). See e2e/README.md.

// Default to :5175 so the harness coexists with a normal `npm run dev`
// on :5174 (vite.config has a hardcoded 5174). Override via E2E_BASE_URL
// or VITE_PORT (read by scripts/e2e-up.mjs).
const BASE_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5175";

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
  webServer: {
    command: "npm run e2e:up",
    cwd: "..",
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
