import { test, expect, seedDemo, SKIP_WRITES } from "../fixtures";

// 3-tier approval pipeline (Approvals.tsx). Tier tabs are themselves role-gated:
// senior sees Tier 1 only, regional adds Tier 2, asset adds Tier 3. Each row
// click opens a review modal requiring typed notes, then POSTs
// /api/approvals/:id/{tier1|tier2|tier3} with {decision:'pass'|'fail', notes}.
// Status transitions: screening_passed → tier1_approved → tier2_approved →
// tier3_approved (pass) | *_denied (fail).

const REVIEW_NOTES = "E2E automated review — verified income docs and eligibility.";

test.beforeEach(async ({ browser, baseURL }) => {
  await seedDemo(browser, baseURL);
});

test.describe("Approvals — tier visibility by role", () => {
  test("senior sees only the Tier 1 tab", async ({ seniorPage }) => {
    await seniorPage.goto("/approvals");
    const main = seniorPage.getByRole("main");
    await expect(main.getByRole("button", { name: /Tier 1/i })).toBeVisible();
    await expect(main.getByRole("button", { name: /Tier 2/i })).toHaveCount(0);
    await expect(main.getByRole("button", { name: /Tier 3/i })).toHaveCount(0);
  });

  test("regional adds the Tier 2 tab", async ({ regionalPage }) => {
    await regionalPage.goto("/approvals");
    const main = regionalPage.getByRole("main");
    await expect(main.getByRole("button", { name: /Tier 2/i })).toBeVisible();
  });

  test("asset adds the Tier 3 tab", async ({ assetPage }) => {
    await assetPage.goto("/approvals");
    const main = assetPage.getByRole("main");
    await expect(main.getByRole("button", { name: /Tier 3/i })).toBeVisible();
  });
});

test.describe("Approvals — review notes are required (write)", () => {
  test.skip(SKIP_WRITES, "mutating spec — local/CI DB only");

  test("approving without notes surfaces a validation error", async ({ seniorPage }) => {
    await seniorPage.goto("/approvals");
    const main = seniorPage.getByRole("main");
    await main.getByRole("button", { name: "View details" }).first().click();

    const dialog = seniorPage.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: /Approve/i }).click();
    await expect(dialog.getByText(/Review notes are required/i)).toBeVisible();
  });
});

test.describe("Approvals — tier 1 decisions (write)", () => {
  test.skip(SKIP_WRITES, "mutating spec — local/CI DB only");

  test("tier 1 Approve moves a screening_passed app out of the queue", async ({ seniorPage }) => {
    await seniorPage.goto("/approvals");
    const main = seniorPage.getByRole("main");

    const rows = main.getByRole("button", { name: "View details" });
    await expect(rows.first()).toBeVisible(); // wait for the queue to load before counting
    const before = await rows.count();
    expect(before).toBeGreaterThan(0);

    await rows.first().click();
    const dialog = seniorPage.getByRole("dialog");
    await dialog.getByPlaceholder(/review notes/i).fill(REVIEW_NOTES);
    await dialog.getByRole("button", { name: /Approve/i }).click();

    // Modal closes and the approved app leaves the Tier 1 queue.
    await expect(dialog).toBeHidden();
    await expect
      .poll(async () => main.getByRole("button", { name: "View details" }).count())
      .toBeLessThan(before);
  });

  test("tier 1 Deny moves an app out of the queue", async ({ seniorPage }) => {
    await seniorPage.goto("/approvals");
    const main = seniorPage.getByRole("main");

    const rows = main.getByRole("button", { name: "View details" });
    await expect(rows.first()).toBeVisible(); // wait for the queue to load before counting
    const before = await rows.count();
    expect(before).toBeGreaterThan(0);

    await rows.first().click();
    const dialog = seniorPage.getByRole("dialog");
    await dialog.getByPlaceholder(/review notes/i).fill("Denied — income exceeds AMI ceiling for the unit.");
    await dialog.getByRole("button", { name: /Deny/i }).click();

    await expect(dialog).toBeHidden();
    await expect
      .poll(async () => main.getByRole("button", { name: "View details" }).count())
      .toBeLessThan(before);
  });
});
