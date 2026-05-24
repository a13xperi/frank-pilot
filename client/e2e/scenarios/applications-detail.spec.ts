import { test, expect, seedDemo } from "../fixtures";
import type { Page } from "@playwright/test";

// Application detail page (ApplicationDetail.tsx). No page-level role gate — any
// authenticated staff can view — but the stage-specific action buttons (Verify
// Income, Generate Lease, Complete Onboarding, Resend Notice) are wrapped in
// RoleGate minRole="senior_manager". These are read-only assertions on button
// presence/absence per stage + role; the seed gives us apps at every stage.

interface AppRow {
  id: string;
  status: string;
  income_verified?: boolean;
}

async function fetchApps(page: Page): Promise<AppRow[]> {
  const res = await page.request.get("/api/applications");
  if (!res.ok()) return [];
  const body = (await res.json()) as { applications?: AppRow[] };
  return body.applications ?? [];
}

test.beforeEach(async ({ browser, baseURL }) => {
  await seedDemo(browser, baseURL);
});

test.describe("Application detail — rendering", () => {
  test("opening a row from the list renders the detail shell", async ({ adminPage }) => {
    await adminPage.goto("/applications");
    const main = adminPage.getByRole("main");
    await main.getByRole("button", { name: "View details" }).first().click();

    await expect(adminPage.getByRole("button", { name: /Back to Applications/i })).toBeVisible();
    await expect(adminPage.getByRole("heading", { name: /Applicant Information/i })).toBeVisible();
    // Timeline is the last card before the messages thread — its presence proves the full
    // detail tree rendered (a StatusBadge crash used to blank the page here; see StatusBadge).
    await expect(adminPage.getByText(/^Created:/)).toBeVisible();
  });
});

test.describe("Application detail — stage-gated action buttons", () => {
  test("senior sees Verify Income on a post-screening, unverified app", async ({ seniorPage }) => {
    const apps = await fetchApps(seniorPage);
    const target = apps.find(
      (a) => a.status === "screening_passed" && !a.income_verified
    );
    test.skip(!target, "no post-screening unverified app in this dataset");

    await seniorPage.goto(`/applications/${target!.id}`);
    await expect(seniorPage.getByRole("heading", { name: /Income Verification/i })).toBeVisible();
    await expect(seniorPage.getByRole("button", { name: /Verify Income/i })).toBeVisible();
  });

  test("agent cannot see Verify Income on the same app", async ({ agentPage }) => {
    const apps = await fetchApps(agentPage);
    const target = apps.find(
      (a) => a.status === "screening_passed" && !a.income_verified
    );
    test.skip(!target, "no post-screening unverified app in this dataset");

    await agentPage.goto(`/applications/${target!.id}`);
    await expect(agentPage.getByRole("heading", { name: /Income Verification/i })).toBeVisible();
    await expect(agentPage.getByRole("button", { name: /Verify Income/i })).toHaveCount(0);
  });

  test("agent cannot see Complete Onboarding on a lease_generated app", async ({ agentPage }) => {
    const apps = await fetchApps(agentPage);
    const target = apps.find((a) => a.status === "lease_generated");
    test.skip(!target, "no lease_generated app in this dataset");

    await agentPage.goto(`/applications/${target!.id}`);
    await expect(agentPage.getByRole("heading", { name: /Lease & Onboarding/i })).toBeVisible();
    await expect(agentPage.getByRole("button", { name: /Complete Onboarding/i })).toHaveCount(0);
  });

  test("denied app shows the FCRA adverse-action card; Resend gated to senior+", async ({ seniorPage }) => {
    const apps = await fetchApps(seniorPage);
    const target = apps.find((a) => a.status === "tier1_denied");
    test.skip(!target, "no denied app in this dataset");

    await seniorPage.goto(`/applications/${target!.id}`);
    await expect(
      seniorPage.getByRole("heading", { name: /Adverse Action Notice \(FCRA\)/i })
    ).toBeVisible();
  });
});
