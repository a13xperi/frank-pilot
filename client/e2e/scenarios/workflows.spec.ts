import { test, expect, seedDemo, SKIP_WRITES } from "../fixtures";

// The senior+ lifecycle pages share one shape: a list whose rows open an action
// modal. This spec covers Renewals, Move-Outs, Evictions, and Recertifications —
// render + gating everywhere, plus one representative write against the data the
// demo seed reliably creates (offered renewal, notice_served violation, submitted
// recert). Move-Out / Report-Violation create flows need real applicant UUIDs, so
// they stay render+gating only. Writes are local/CI-DB-only.

test.beforeEach(async ({ browser, baseURL }) => {
  await seedDemo(browser, baseURL);
});

// ---------------------------------------------------------------------------
// Renewals
// ---------------------------------------------------------------------------
test.describe("Renewals", () => {
  test("the renewals list renders for senior+", async ({ seniorPage }) => {
    await seniorPage.goto("/renewals");
    const main = seniorPage.getByRole("main");
    await expect(main.getByRole("heading", { name: /Lease Renewals/i })).toBeVisible();
    await expect(main.getByRole("button", { name: "View details" }).first()).toBeVisible();
  });

  test.describe("write", () => {
    test.skip(SKIP_WRITES, "mutating spec — local/CI DB only");

    test("senior accepts the seeded 'offered' renewal", async ({ seniorPage }) => {
      await seniorPage.goto("/renewals");
      const main = seniorPage.getByRole("main");
      // The seed plants one renewal in status 'offered' (Keisha Williams) — the
      // only state that surfaces Accept/Decline.
      const row = main.getByRole("button", { name: "View details" }).filter({ hasText: /Williams/i });
      await expect(row).toBeVisible();
      await row.click();

      const dialog = seniorPage.getByRole("dialog");
      await dialog.getByRole("button", { name: /^Accept$/ }).click();
      await expect(dialog).toBeHidden();
      await expect(main.getByText(/Renewal accepted/i)).toBeVisible();
    });
  });
});

// ---------------------------------------------------------------------------
// Move-Outs
// ---------------------------------------------------------------------------
test.describe("Move-Outs", () => {
  test("the move-outs list renders for senior+", async ({ seniorPage }) => {
    await seniorPage.goto("/moveouts");
    const main = seniorPage.getByRole("main");
    await expect(main.getByRole("heading", { name: /Move-Outs/i })).toBeVisible();
  });

  test("agent cannot initiate a move-out", async ({ agentPage }) => {
    await agentPage.goto("/moveouts");
    // Page itself isn't role-gated, but the create action is senior+.
    await expect(agentPage.getByRole("button", { name: /Initiate Move-Out/i })).toHaveCount(0);
  });

  test("senior can see Initiate Move-Out", async ({ seniorPage }) => {
    await seniorPage.goto("/moveouts");
    await expect(
      seniorPage.getByRole("main").getByRole("button", { name: /Initiate Move-Out/i }),
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Evictions & Violations
// ---------------------------------------------------------------------------
test.describe("Evictions & Violations", () => {
  test("the page renders with Violations/Notices/Cases tabs", async ({ seniorPage }) => {
    await seniorPage.goto("/evictions");
    const main = seniorPage.getByRole("main");
    await expect(main.getByRole("heading", { name: /Evictions & Violations/i })).toBeVisible();
    // Tab labels carry a live count suffix ("Violations 1"), so anchor the start only.
    await expect(main.getByRole("button", { name: /^Violations/ })).toBeVisible();
    await expect(main.getByRole("button", { name: /^Notices/ })).toBeVisible();
    await expect(main.getByRole("button", { name: /^Cases/ })).toBeVisible();
  });

  test("agent cannot report a violation", async ({ agentPage }) => {
    await agentPage.goto("/evictions");
    await expect(agentPage.getByRole("button", { name: /Report Violation/i })).toHaveCount(0);
  });

  test.describe("write", () => {
    test.skip(SKIP_WRITES, "mutating spec — local/CI DB only");

    // Eviction lists are property-scoped (src/middleware/scope.ts); senior@cdpc.test
    // has no property_ids → denyAll empties the list. regional_manager is global-scope
    // AND ≥ senior_manager, so the senior-gated Resolve button still renders.
    test("manager resolves the seeded violation", async ({ regionalPage }) => {
      await regionalPage.goto("/evictions");
      const main = regionalPage.getByRole("main");
      // The seed plants one violation (Tomasz Kowalski) in status 'notice_served';
      // any non-resolved/dismissed state surfaces Resolve.
      const row = main.getByRole("button", { name: "View details" }).filter({ hasText: /Kowalski/i });
      await expect(row).toBeVisible();
      await row.click();

      const dialog = regionalPage.getByRole("dialog");
      await dialog.getByPlaceholder(/Resolution \/ dismissal notes/i).fill("Cured on inspection; tenant compliant.");
      await dialog.getByRole("button", { name: /^Resolve$/ }).click();
      await expect(dialog).toBeHidden();
    });
  });
});

// ---------------------------------------------------------------------------
// Recertifications
// ---------------------------------------------------------------------------
test.describe("Recertifications", () => {
  test("the page renders with status tabs", async ({ seniorPage }) => {
    await seniorPage.goto("/recertifications");
    const main = seniorPage.getByRole("main");
    await expect(main.getByRole("heading", { name: /Recertifications/i })).toBeVisible();
    await expect(main.getByRole("button", { name: /^Submitted$/ })).toBeVisible();
    await expect(main.getByRole("button", { name: /^Approved$/ })).toBeVisible();
  });

  test.describe("write", () => {
    test.skip(SKIP_WRITES, "mutating spec — local/CI DB only");

    // Recert lists are property-scoped (src/middleware/scope.ts); senior@cdpc.test
    // has no property_ids → empty list. regional_manager is global-scope and ≥ senior.
    test("manager approves a submitted recertification", async ({ regionalPage }) => {
      await regionalPage.goto("/recertifications");
      const main = regionalPage.getByRole("main");
      // Narrow to the seeded 'submitted' rows — the only state with a Review Decision.
      await main.getByRole("button", { name: /^Submitted$/ }).click();
      const row = main.getByRole("button", { name: "View details" }).first();
      await expect(row).toBeVisible();
      await row.click();

      const dialog = regionalPage.getByRole("dialog");
      await dialog.getByPlaceholder(/Review notes/i).fill("Income re-verified; within limits.");
      await dialog.getByRole("button", { name: /^Approve$/ }).click();
      await expect(dialog).toBeHidden();
      await expect(main.getByText(/Recertification approved/i)).toBeVisible();
    });
  });
});
