import { test, expect, seedDemo, SKIP_WRITES } from "../fixtures";

// Inspections (Inspections.tsx). "Schedule Inspection" and the in-modal
// "Complete Inspection" are both gated minRole="senior_manager". Schedule posts
// /api/inspections; complete posts /api/inspections/:id/complete. Reads run
// anywhere; schedule + complete are local/CI-DB-only.

test.beforeEach(async ({ browser, baseURL }) => {
  await seedDemo(browser, baseURL);
});

test.describe("Inspections — rendering", () => {
  test("KPI cards and the table render", async ({ seniorPage }) => {
    await seniorPage.goto("/inspections");
    const main = seniorPage.getByRole("main");
    await expect(main.getByRole("heading", { name: /Inspections/i })).toBeVisible();
    // "Scheduled" appears as both a KPI label and a table column header — first() avoids strict mode.
    await expect(main.getByText("Scheduled").first()).toBeVisible();
    await expect(main.getByText("Overdue")).toBeVisible();
    await expect(main.getByText("Completed").first()).toBeVisible();
  });
});

test.describe("Inspections — schedule then complete (write)", () => {
  test.skip(SKIP_WRITES, "mutating spec — local/CI DB only");

  // Scheduling enforces property scope (POST /api/inspections → callerCanAccessProperty)
  // and the listing is scoped too; senior@cdpc.test has no property_ids. regional_manager
  // is global-scope and ≥ senior_manager, so the senior-gated Schedule/Complete buttons render.
  test("schedule an inspection, then complete it", async ({ regionalPage }) => {
    const unit = `E2E-${Date.now() % 100000}`;
    const future = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    await regionalPage.goto("/inspections");
    const main = regionalPage.getByRole("main");

    // --- Schedule ---
    await main.getByRole("button", { name: /Schedule Inspection/i }).click();
    const schedDialog = regionalPage.getByRole("dialog");
    await schedDialog.locator("select").first().selectOption({ index: 1 });
    await schedDialog.locator('input[type="date"]').fill(future);
    await schedDialog.getByPlaceholder(/A-102/i).fill(unit);
    await schedDialog.getByRole("button", { name: /^Schedule$/ }).click();
    await expect(schedDialog).toBeHidden();
    await expect(main.getByText(/Inspection scheduled/i)).toBeVisible();

    const row = main.getByRole("button", { name: "View details" }).filter({ hasText: unit });
    await expect(row).toBeVisible();

    // --- Complete ---
    await row.click();
    const detail = regionalPage.getByRole("dialog");
    await detail.getByPlaceholder(/Room-by-room notes/i).fill("All rooms inspected, smoke detectors verified.");
    await detail.getByRole("button", { name: /Complete Inspection/i }).click();
    await expect(detail).toBeHidden();
    await expect(main.getByText(/Inspection completed/i)).toBeVisible();
  });
});
