import { test, expect } from "../fixtures";

// Core staff pages load without error for a senior_manager, both via the
// sidebar and by deep-link. Guards against blank-screen / crash regressions.

const PAGES = [
  { nav: "Screening", path: "/screening", heading: /^Screening$/ },
  { nav: "Approvals", path: "/approvals", heading: /^Approvals$/ },
  { nav: "Properties", path: "/properties", heading: /^Properties$/ },
  { nav: "Maintenance", path: "/maintenance", heading: /^Maintenance$/ },
] as const;

test.describe("Navigation (senior_manager)", () => {
  for (const p of PAGES) {
    test(`sidebar → ${p.nav} renders its page`, async ({ seniorPage: page }) => {
      await page.getByRole("navigation").getByRole("link", { name: p.nav }).click();
      await expect(page).toHaveURL(new RegExp(`${p.path}$`));
      await expect(page.getByRole("heading", { name: p.heading })).toBeVisible();
    });
  }

  test("deep-linking straight to a page works", async ({ seniorPage: page }) => {
    await page.goto("/maintenance");
    await expect(page.getByRole("heading", { name: /^Maintenance$/ })).toBeVisible();
    // The three KPI cards are always present, even with zero work orders.
    await expect(page.getByText(/Emergencies/i)).toBeVisible();
    await expect(page.getByText(/Open Orders/i)).toBeVisible();
  });

  test("New Work Order modal offers only valid priorities", async ({ seniorPage: page }) => {
    await page.goto("/maintenance");
    await page.getByRole("button", { name: /New Work Order/i }).click();

    const priority = page.locator("select").filter({ hasText: /Routine/ }).first();
    await expect(priority).toBeVisible();
    // Must match the work_order_priority enum — no medium/high/critical.
    const options = await priority.locator("option").allInnerTexts();
    expect(options.map((o) => o.toLowerCase())).toEqual([
      "low",
      "routine",
      "urgent",
      "emergency",
    ]);
  });
});
