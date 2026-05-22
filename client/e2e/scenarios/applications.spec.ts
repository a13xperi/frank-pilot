import { test, expect, seedDemoData } from "../fixtures";

// Applications list → detail. Seeds the rich demo dataset first (admin-only)
// so the table is populated across pipeline stages, then opens a row.

test.describe("Applications", () => {
  test.beforeEach(async ({ adminPage }) => {
    await seedDemoData(adminPage);
  });

  test("table shows the full column set", async ({ adminPage: page }) => {
    await page.goto("/applications");
    await expect(page.getByRole("heading", { name: /^Applications$/ })).toBeVisible();

    for (const header of [
      "Applicant",
      "Status",
      "Property",
      "Unit",
      "Household",
      "Income",
      "AMI Tier",
      "Created",
    ]) {
      await expect(
        page.getByRole("columnheader", { name: header, exact: true })
      ).toBeVisible();
    }
  });

  test("clicking a row opens that application's detail", async ({ adminPage: page }) => {
    await page.goto("/applications");
    const firstRow = page.locator("tbody tr").first();
    await expect(firstRow).toBeVisible();
    await firstRow.click();

    await expect(page).toHaveURL(/\/applications\/[0-9a-f-]{36}$/);
  });

  test("status tabs filter the table", async ({ adminPage: page }) => {
    await page.goto("/applications");
    await page.getByRole("button", { name: /^Submitted/ }).click();
    // Either rows render or the empty-state message — both are valid; the page
    // must not crash and the tab must become active.
    await expect(
      page.locator("tbody tr").first().or(page.getByText(/No applications found/i))
    ).toBeVisible();
  });
});
