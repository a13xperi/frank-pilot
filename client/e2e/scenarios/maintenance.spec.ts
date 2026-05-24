import { test, expect, seedDemo, SKIP_WRITES } from "../fixtures";

// Maintenance work orders (Maintenance.tsx). "New Work Order" is open to all
// staff; the lifecycle actions (Assign → Start Work → Complete) live behind a
// RoleGate minRole="senior_manager" in the detail modal. New WOs start
// 'submitted'. Reads run anywhere; create + lifecycle are local/CI-DB-only.

test.beforeEach(async ({ browser, baseURL }) => {
  await seedDemo(browser, baseURL);
});

test.describe("Maintenance — rendering", () => {
  test("KPI cards and the work-order table render", async ({ adminPage }) => {
    await adminPage.goto("/maintenance");
    const main = adminPage.getByRole("main");
    await expect(main.getByRole("heading", { name: /Maintenance/i })).toBeVisible();
    await expect(main.getByText("Emergencies")).toBeVisible();
    await expect(main.getByText("Open Orders")).toBeVisible();
    // "Completed" is both a KPI label and a row status badge — first() targets the KPI.
    await expect(main.getByText("Completed").first()).toBeVisible();
    await expect(main.getByRole("button", { name: /New Work Order/i })).toBeVisible();
  });
});

test.describe("Maintenance — create + full lifecycle (write)", () => {
  test.skip(SKIP_WRITES, "mutating spec — local/CI DB only");

  test("create a work order, then Assign → Start Work → Complete", async ({ adminPage }) => {
    const title = `E2E Work Order ${Date.now()}`;
    await adminPage.goto("/maintenance");
    const main = adminPage.getByRole("main");

    // --- Create ---
    await main.getByRole("button", { name: /New Work Order/i }).click();
    const createDialog = adminPage.getByRole("dialog");
    await expect(createDialog).toBeVisible();
    // Property is the first <select> in the create form; index 1 = first real option.
    await createDialog.locator("select").first().selectOption({ index: 1 });
    await createDialog.getByPlaceholder("Brief description").fill(title);
    await createDialog.getByPlaceholder("Full details of the issue").fill("Automated e2e lifecycle work order.");
    await createDialog.getByRole("button", { name: /^Create$/ }).click();
    await expect(createDialog).toBeHidden();

    const row = main.getByRole("button", { name: "View details" }).filter({ hasText: title });
    await expect(row).toBeVisible();

    // --- Assign (submitted → assigned) ---
    await row.click();
    let detail = adminPage.getByRole("dialog");
    await detail.locator("select").first().selectOption({ index: 1 });
    await detail.getByRole("button", { name: /^Assign$/ }).click();
    await expect(detail).toBeHidden();
    await expect(main.getByText(/Work order assigned/i)).toBeVisible();

    // --- Start Work (assigned → in_progress) ---
    await row.click();
    detail = adminPage.getByRole("dialog");
    await detail.getByRole("button", { name: /Start Work/i }).click();
    await expect(detail).toBeHidden();
    await expect(main.getByText(/Work started/i)).toBeVisible();

    // --- Complete (in_progress → completed) ---
    await row.click();
    detail = adminPage.getByRole("dialog");
    await detail.getByPlaceholder(/Completion notes/i).fill("Repaired and verified on site.");
    await detail.getByRole("button", { name: /^Complete$/ }).click();
    await expect(detail).toBeHidden();
    await expect(main.getByText(/Work order completed/i)).toBeVisible();

    // The row now carries a Completed status badge.
    await expect(row.getByText(/Completed/i)).toBeVisible();
  });
});

test.describe("Maintenance — lifecycle actions are gated", () => {
  test("agent opening a work order sees no Assign/Start/Complete actions", async ({ agentPage }) => {
    await agentPage.goto("/maintenance");
    const main = agentPage.getByRole("main");
    const firstRow = main.getByRole("button", { name: "View details" }).first();
    test.skip((await firstRow.count()) === 0, "no work orders in this dataset");

    await firstRow.click();
    const detail = agentPage.getByRole("dialog");
    await expect(detail).toBeVisible();
    await expect(detail.getByRole("button", { name: /^Assign$/ })).toHaveCount(0);
    await expect(detail.getByRole("button", { name: /Start Work/i })).toHaveCount(0);
    await expect(detail.getByRole("button", { name: /^Complete$/ })).toHaveCount(0);
  });
});
