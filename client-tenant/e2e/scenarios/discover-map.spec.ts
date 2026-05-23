// 17/4/13 are the curated GPMG availability set (nv-gpmg-map-props.json).
// If you edit that file, update these expected counts.
//
// NOTE: playwright.config.ts only defines a single "chromium" project (Desktop
// Chrome). There is no mobile-chrome project with @mobile grep routing. The
// mobile stacking test below manually sets a Pixel-5-sized viewport instead of
// relying on project-level routing. Add a mobile-chrome project to
// playwright.config.ts and reinstate a grepString/grepInvert pairing if you
// want true multi-project mobile CI runs.

import { test, expect } from "../fixtures";

// The map page is a static HTML file served at /nv-housing-map.html.
// Data loads async (three parallel fetches + merge); we poll #count until a
// non-zero leading integer appears before making count assertions.

/** Parse the leading integer from `#count` innerText (e.g. "352 communities of 352"). */
async function leadingCount(page: import("@playwright/test").Page): Promise<number> {
  const text = await page.locator("#count").innerText();
  return Number(text.match(/^(\d+)/)?.[1] ?? "0");
}

test.describe("nv-housing-map.html — hybrid map regression lock", () => {
  // ── Default view (no filter) ─────────────────────────────────────────────

  test("default load shows ≥ 300 communities (collapse-to-17 guard)", async ({ page }) => {
    await page.goto("/nv-housing-map.html");
    await expect
      .poll(() => leadingCount(page), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(1); // wait for any count to appear
    const n = await leadingCount(page);
    expect(n).toBeGreaterThanOrEqual(300);
  });

  // ── Availability filter ──────────────────────────────────────────────────

  test("availability=available_now narrows to exactly 17", async ({ page }) => {
    await page.goto("/nv-housing-map.html?availability=available_now");
    await expect
      .poll(() => leadingCount(page), { timeout: 15_000 })
      .toBeGreaterThan(0);
    expect(await leadingCount(page)).toBe(17);
  });

  test("availability=available_now&type=family narrows to exactly 4", async ({ page }) => {
    await page.goto("/nv-housing-map.html?availability=available_now&type=family");
    await expect
      .poll(() => leadingCount(page), { timeout: 15_000 })
      .toBeGreaterThan(0);
    expect(await leadingCount(page)).toBe(4);
  });

  test("availability=available_now&type=senior narrows to exactly 13", async ({ page }) => {
    await page.goto("/nv-housing-map.html?availability=available_now&type=senior");
    await expect
      .poll(() => leadingCount(page), { timeout: 15_000 })
      .toBeGreaterThan(0);
    expect(await leadingCount(page)).toBe(13);
  });

  // ── City dropdown (chip-wall fix) ────────────────────────────────────────

  test("city dropdown #citySel is visible and has ≥ 25 options", async ({ page }) => {
    await page.goto("/nv-housing-map.html");
    // Wait for data to load (filters are built after hydrate())
    await expect
      .poll(() => leadingCount(page), { timeout: 15_000 })
      .toBeGreaterThan(0);
    const citySel = page.locator("#citySel");
    await expect(citySel).toBeVisible();
    const optionCount = await citySel.locator("option").count();
    expect(optionCount).toBeGreaterThanOrEqual(25); // ~30 cities + "All cities" option
  });

  // ── Leaflet markers render ───────────────────────────────────────────────

  test("markers render on default load", async ({ page }) => {
    await page.goto("/nv-housing-map.html");
    await expect
      .poll(() => leadingCount(page), { timeout: 15_000 })
      .toBeGreaterThan(0);
    // Leaflet renders cluster icons and individual pin icons both with
    // .leaflet-marker-icon; at least one must appear.
    await expect(page.locator(".leaflet-marker-icon").first()).toBeVisible({ timeout: 10_000 });
    const markerCount = await page.locator(".leaflet-marker-icon").count();
    expect(markerCount).toBeGreaterThan(0);
  });

  // ── Mobile stacking @mobile ──────────────────────────────────────────────
  // Pixel 5 viewport: 393 × 851. The responsive CSS stacks .map-col ABOVE
  // .list-col on mobile (map-col has order:-1 / comes first in DOM flex column).

  test("stacks map above list on mobile @mobile", async ({ page }) => {
    // Pixel 5 logical dimensions (same as devices["Pixel 5"]).
    await page.setViewportSize({ width: 393, height: 851 });
    await page.goto("/nv-housing-map.html");
    await expect
      .poll(() => leadingCount(page), { timeout: 15_000 })
      .toBeGreaterThan(0);

    const mapBox = await page.locator(".map-col").boundingBox();
    const listBox = await page.locator(".list-col").boundingBox();
    expect(mapBox).not.toBeNull();
    expect(listBox).not.toBeNull();
    // map-col must render above (smaller Y) than list-col
    expect(mapBox!.y).toBeLessThan(listBox!.y);
  });
});
