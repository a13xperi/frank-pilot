import { test, expect } from "../fixtures";

// Dashboard for a senior_manager: 5 clickable stat cards that deep-link into
// the relevant queues (PR #140 made every card a <Link>). Locators are scoped
// to <main> so they don't collide with same-named sidebar nav links.

test.describe("Dashboard (senior_manager)", () => {
  test("renders all five clickable stat cards", async ({ seniorPage: page }) => {
    await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible();
    const main = page.getByRole("main");

    for (const label of [
      /Active Applications/i,
      /Signups/i,
      /Pending Screening/i,
      /Pending Approvals/i,
      /^Properties/i,
    ]) {
      await expect(main.getByRole("link", { name: label })).toBeVisible();
    }
  });

  test("Pending Screening card navigates to /screening", async ({ seniorPage: page }) => {
    await page.getByRole("main").getByRole("link", { name: /Pending Screening/i }).click();
    await expect(page).toHaveURL(/\/screening$/);
    await expect(page.getByRole("heading", { name: /^Screening$/ })).toBeVisible();
  });

  test("Properties card navigates to /properties", async ({ seniorPage: page }) => {
    await page.getByRole("main").getByRole("link", { name: /^Properties/i }).click();
    await expect(page).toHaveURL(/\/properties$/);
    await expect(page.getByRole("heading", { name: /^Properties$/ })).toBeVisible();
  });
});
