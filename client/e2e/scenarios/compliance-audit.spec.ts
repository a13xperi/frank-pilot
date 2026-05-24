import { test, expect, seedDemo } from "../fixtures";

// The three oversight pages — Compliance, Audit Log, QA Bundles — are all gated
// minRole="regional_manager". Their agent/senior denials are covered in
// rbac.spec; here we drive them from a regional_manager and assert the panels
// render. These are read-only views (no SKIP_WRITES guard needed); seeded demo
// data just gives the fair-housing report something to count.

test.beforeEach(async ({ browser, baseURL }) => {
  await seedDemo(browser, baseURL);
});

test.describe("Compliance — fair-housing report", () => {
  test("the report and its sections render for regional+", async ({ regionalPage }) => {
    await regionalPage.goto("/compliance");
    const main = regionalPage.getByRole("main");
    await expect(main.getByRole("heading", { name: /^Compliance$/ })).toBeVisible();
    // Property selector defaults to "All Properties".
    await expect(main.locator("select")).toBeVisible();
    // The three report sections.
    await expect(main.getByRole("heading", { name: /Application Decisions/i })).toBeVisible();
    await expect(main.getByRole("heading", { name: /FCRA Adverse Action/i })).toBeVisible();
    await expect(main.getByRole("heading", { name: /Objective Screening Criteria/i })).toBeVisible();
  });
});

test.describe("Audit Log — entries + compliance tape", () => {
  test("the audit log, filters, and tape panel render for regional+", async ({ regionalPage }) => {
    await regionalPage.goto("/audit-log");
    const main = regionalPage.getByRole("main");
    await expect(main.getByRole("heading", { name: /^Audit Log$/ })).toBeVisible();
    await expect(main.getByPlaceholder(/Filter by Application ID/i)).toBeVisible();
    await expect(main.getByRole("button", { name: /^Next$/ })).toBeVisible();

    // Compliance Tape panel sits below the log.
    await expect(main.getByRole("heading", { name: /Compliance Tape/i })).toBeVisible();
    await expect(main.getByPlaceholder(/Applicant ID/i)).toBeVisible();
  });

  test("searching an applicant surfaces the Verify Chain + Export PDF actions", async ({ regionalPage }) => {
    await regionalPage.goto("/audit-log");
    const main = regionalPage.getByRole("main");
    // The tape action buttons only mount once an applicant scope is searched.
    await main.getByPlaceholder(/Applicant ID/i).fill("00000000-0000-0000-0000-000000000000");
    await main.getByRole("button", { name: /^Search$/ }).click();
    await expect(main.getByRole("button", { name: /Verify Chain/i })).toBeVisible();
    await expect(main.getByRole("button", { name: /Export PDF/i })).toBeVisible();
  });
});

test.describe("QA Bundles", () => {
  test("the bundle list page renders for regional+", async ({ regionalPage }) => {
    await regionalPage.goto("/qa-bundles");
    const main = regionalPage.getByRole("main");
    await expect(main.getByRole("heading", { name: /QA Bundles/i })).toBeVisible();

    // Bundles come from QA screenshot uploads, not the demo seed, so the list may
    // be empty. When a bundle exists, its row links to the detail deep-link.
    const viewLink = main.getByRole("link", { name: /View/i }).first();
    if ((await viewLink.count()) > 0) {
      await expect(viewLink).toHaveAttribute("href", /\/qa-bundles\/.+/);
    }
  });
});
