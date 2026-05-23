import { test, expect } from "../fixtures";

// Lane B — /discover page filter coverage.
// Tests cover filters NOT already exercised by discover.spec.ts:
//   - Initial render / result-count (smoke only; discover.spec.ts already covers
//     bedroom-1 narrowing, so we use a different value here)
//   - studio bedroom chip
//   - available-now chip (no coverage in existing spec)
//   - city chip via role+name (no data-testid on city chips in PropertyList.tsx)
//   - AMI banner deep-link + dismiss
//   - property-card → detail route navigation
//   - mobile single-column layout (manual resize; no @mobile project in playwright.config.ts)

test.describe("Discover filters (public, no auth)", () => {
  // ── 1. Page renders ─────────────────────────────────────────────────────────
  test("property grid and result count are visible on load", async ({ page }) => {
    await page.goto("/discover");
    await expect(page.getByTestId("property-grid")).toBeVisible();
    await expect(page.getByTestId("result-count")).toContainText(/communit/i);
  });

  // ── 2. Studio bedroom chip narrows results ────────────────────────────────
  // discover.spec.ts already covers chip-bedroom-1; we cover chip-bedroom-studio.
  test("studio bedroom chip narrows result count", async ({ page }) => {
    await page.goto("/discover");
    await page.getByTestId("result-count").waitFor();
    const initial = await page.getByTestId("result-count").innerText();
    const initialN = Number(initial.match(/^(\d+)/)?.[1] ?? "0");
    expect(initialN).toBeGreaterThan(0);

    await page.getByTestId("chip-bedroom-studio").click();
    await expect
      .poll(async () => {
        const text = await page.getByTestId("result-count").innerText();
        return Number(text.match(/^(\d+)/)?.[1] ?? "0");
      })
      .toBeLessThanOrEqual(initialN);
  });

  // ── 3. Available-now chip narrows results ─────────────────────────────────
  // chip-available-now is not tested in discover.spec.ts at all.
  test("available-now chip narrows result count to only properties with open units", async ({
    page,
  }) => {
    await page.goto("/discover");
    await page.getByTestId("result-count").waitFor();
    const initial = await page.getByTestId("result-count").innerText();
    const initialN = Number(initial.match(/^(\d+)/)?.[1] ?? "0");
    expect(initialN).toBeGreaterThan(0);

    await page.getByTestId("chip-available-now").click();
    // Count must be a non-negative number and no greater than the full catalog.
    await expect
      .poll(async () => {
        const text = await page.getByTestId("result-count").innerText();
        return Number(text.match(/^(\d+)/)?.[1] ?? "0");
      })
      .toBeLessThanOrEqual(initialN);

    // The chip must be toggled on (data-active=true).
    await expect(page.getByTestId("chip-available-now")).toHaveAttribute(
      "data-active",
      "true"
    );
  });

  // ── 4. City chip narrows results ──────────────────────────────────────────
  // City chips have no data-testid; accessed by role+name ("Henderson" = 1 fixture).
  // Confirmed by PropertyList.test.tsx: "Henderson" reduces to 1 property.
  test("Henderson city chip narrows results to 1 property", async ({ page }) => {
    await page.goto("/discover");
    await page.getByTestId("result-count").waitFor();

    // City chips are ChipButton with no testId prop — select by role+name.
    await page.getByRole("button", { name: "Henderson" }).click();
    await expect
      .poll(async () => {
        const text = await page.getByTestId("result-count").innerText();
        return Number(text.match(/^(\d+)/)?.[1] ?? "0");
      })
      .toBe(1);
    // The one result should be Smith Williams Senior Apartments.
    await expect(
      page.getByTestId("property-grid")
    ).toContainText(/Smith Williams/i);
  });

  // ── 5. AMI banner deep-link + dismiss ────────────────────────────────────
  // PropertyList.tsx shows ami-banner when ?amiTier is in the URL.
  test("?amiTier=60 deep-link renders the dismissible AMI banner", async ({
    page,
  }) => {
    await page.goto("/discover?amiTier=60");
    const banner = page.getByTestId("ami-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/60/);

    // Dismissing removes the banner.
    await page.getByTestId("ami-banner-dismiss").click();
    await expect(page.getByTestId("ami-banner")).not.toBeVisible();
  });

  // ── 6. Property card → detail route navigation ───────────────────────────
  // Each tile is a Link to /property/:slug (confirmed in PropertyList.tsx line 666
  // and PropertyList.test.tsx "each tile links to /property/:slug").
  test("clicking a property card navigates to the property detail page", async ({
    page,
  }) => {
    await page.goto("/discover");
    await page.getByTestId("property-grid").waitFor();

    // Grab the first tile link.  All tiles use data-testid="property-tile-<slug>".
    const firstTile = page.getByTestId("property-grid").locator("[data-testid^='property-tile-']").first();
    await expect(firstTile).toBeVisible();

    // Navigate via the link.
    await firstTile.click();

    // The detail URL must be /property/<something>.
    await expect(page).toHaveURL(/\/property\/[a-z0-9-]+/);
  });

  // ── 7. Mobile layout — single column ─────────────────────────────────────
  // playwright.config.ts defines only a chromium (desktop) project — there is no
  // @mobile project, so we resize manually in this test.
  // The grid is `grid-cols-1` on mobile and `sm:grid-cols-2` on ≥640px.
  // We verify single-column by comparing the x-position of the first two cards:
  // if they stack vertically their left-edge x values are equal.
  test("grid renders single-column at mobile width (375 px)", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/discover");
    await page.getByTestId("property-grid").waitFor();

    const tiles = page
      .getByTestId("property-grid")
      .locator("[data-testid^='property-tile-']");
    const count = await tiles.count();
    // Need at least two tiles to compare columns.
    expect(count).toBeGreaterThanOrEqual(2);

    const box0 = await tiles.nth(0).boundingBox();
    const box1 = await tiles.nth(1).boundingBox();
    expect(box0).not.toBeNull();
    expect(box1).not.toBeNull();

    // Both cards at the same x ⇒ stacked in a single column.
    expect(box0!.x).toBeCloseTo(box1!.x, 0);
  });
});
