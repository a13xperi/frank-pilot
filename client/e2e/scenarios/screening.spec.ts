import { test, expect, seedDemo, SKIP_WRITES } from "../fixtures";

// Screening queue (senior+). Submitted applications carry a "Screen" action that
// POSTs /api/screening/:id/screen and moves the app to screening_passed/failed.
// Reads run anywhere; the mutation is local/CI-DB-only (SKIP_WRITES guard).

test.beforeEach(async ({ browser, baseURL }) => {
  await seedDemo(browser, baseURL);
});

test.describe("Screening — queue renders", () => {
  test("senior_manager sees the queue with submitted applications", async ({ seniorPage }) => {
    await seniorPage.goto("/screening");
    const main = seniorPage.getByRole("main");
    await expect(main.getByRole("heading", { name: /Screening/i })).toBeVisible();
    await expect(main.getByRole("button", { name: /Queue/i })).toBeVisible();
    await expect(main.getByRole("button", { name: /Completed/i })).toBeVisible();
    // Seeded data guarantees at least one submitted app with a Screen action.
    await expect(main.getByRole("button", { name: /Screen/i }).first()).toBeVisible();
  });
});

test.describe("Screening — run a decision (write)", () => {
  test.skip(SKIP_WRITES, "mutating spec — local/CI DB only");

  test("screening a submitted app transitions its status", async ({ seniorPage }) => {
    await seniorPage.goto("/screening");
    const main = seniorPage.getByRole("main");

    const firstScreen = main.getByRole("button", { name: /Screen/i }).first();
    await expect(firstScreen).toBeVisible();

    // Capture how many submitted rows carry a Screen action, then run one.
    const before = await main.getByRole("button", { name: /Screen/i }).count();
    await firstScreen.click();

    // The screened row leaves the queue (moves to screening_passed/failed), so
    // the Screen-action count drops by one.
    await expect
      .poll(async () => main.getByRole("button", { name: /Screen/i }).count())
      .toBeLessThan(before);

    // The outcome is visible on the Completed tab as a passed/failed badge.
    await main.getByRole("button", { name: /Completed/i }).click();
    await expect(
      main.getByText(/Screening (Passed|Failed)/i).first()
    ).toBeVisible();
  });
});
