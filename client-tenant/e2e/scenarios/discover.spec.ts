import { test, expect } from "../fixtures";

// Public /discover page — no auth needed. Exercises the bedroom-chip filter
// from gpmglv wedge #8/#9 and the result-count counter.

test.describe("Discover (public listings)", () => {
  test("renders the GPMG catalog and the result counter", async ({ page }) => {
    await page.goto("/discover");
    await expect(page.getByTestId("property-grid")).toBeVisible();
    await expect(page.getByTestId("result-count")).toContainText(/communit/i);
  });

  test("bedroom filter narrows the result count", async ({ page }) => {
    await page.goto("/discover");
    await page.getByTestId("result-count").waitFor();
    const initial = await page.getByTestId("result-count").innerText();
    const initialN = Number(initial.match(/^(\d+)/)?.[1] ?? "0");
    expect(initialN).toBeGreaterThan(0);

    // Bedroom chips use the raw key ('all'|'studio'|'1'|'2'|'3') as suffix.
    await page.getByTestId("chip-bedroom-1").click();
    await expect
      .poll(async () => {
        const text = await page.getByTestId("result-count").innerText();
        return Number(text.match(/^(\d+)/)?.[1] ?? "0");
      })
      .toBeLessThanOrEqual(initialN);
  });
});
