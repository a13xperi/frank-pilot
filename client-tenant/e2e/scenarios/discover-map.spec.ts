// 17/4/13 are the curated GPMG availability set (nv-gpmg-map-props.json).
// If you edit that file, update these expected counts.
//
// Phase 2-A: React (/discover?view=map) is now the single source of filter
// truth. The map (/nv-housing-map.html) is a near-pure render surface — its own
// filter rail + card list were removed. `#count` is now a small overlay pill on
// the map surface (top-left, warm-paper style); it keeps a leading integer so
// the count regression lock below still parses ^(\d+). The map still boots
// filters from its src querystring (initFiltersFromURL) for deep-links + direct
// nav, which is what the direct-navigation count tests exercise. The React
// integration test exercises the postMessage transport.

import { test, expect } from "../fixtures";

// The map page is a static HTML file served at /nv-housing-map.html.
// Data loads async (three parallel fetches + merge); we poll #count until a
// non-zero leading integer appears before making count assertions.

/** Parse the leading integer from `#count` innerText (e.g. "352 of 352"). */
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

  // ── Mobile: map fills the width @mobile ──────────────────────────────────
  // Phase 2-A removed the list rail, so the map is a single full-width column
  // at every breakpoint. There's no more stacking to assert; instead confirm
  // the map column spans (≈) the full viewport width on a phone-sized screen.

  test("map fills the viewport width on mobile @mobile", async ({ page }) => {
    // Pixel 5 logical dimensions (same as devices["Pixel 5"]).
    await page.setViewportSize({ width: 393, height: 851 });
    await page.goto("/nv-housing-map.html");
    await expect
      .poll(() => leadingCount(page), { timeout: 15_000 })
      .toBeGreaterThan(0);

    const mapBox = await page.locator(".map-col").boundingBox();
    expect(mapBox).not.toBeNull();
    // Full-bleed: the map column spans (nearly) the full 393px viewport width.
    expect(mapBox!.width).toBeGreaterThanOrEqual(380);
  });
});

// ── React-driven integration: /discover?view=map → postMessage ────────────
// Proves the Phase 2-A collapse end-to-end: the React parent owns the filter
// chips and drives the iframe map via the 'frank:filters' postMessage (NO
// iframe reload). Clicking the React "Available now" chip must narrow the
// map's #count to 17 without touching the iframe src.
test.describe("discover map — React postMessage integration", () => {
  test("React 'Available now' chip narrows map #count to 17 via postMessage", async ({
    page,
  }) => {
    await page.goto("/discover?view=map");

    const frame = page.frameLocator('[data-testid="discover-map-iframe"]');

    // Wait for the iframe map to hydrate (its #count gets a leading integer).
    await expect
      .poll(
        async () => {
          const text = await frame.locator("#count").innerText().catch(() => "0");
          return Number(text.match(/^(\d+)/)?.[1] ?? "0");
        },
        { timeout: 20_000 },
      )
      .toBeGreaterThanOrEqual(300);

    // Click the React-owned "Available now" chip in the PARENT page.
    await page.getByTestId("chip-available-now").click();

    // The postMessage path must narrow the map to exactly 17 — no reload.
    await expect
      .poll(
        async () => {
          const text = await frame.locator("#count").innerText().catch(() => "0");
          return Number(text.match(/^(\d+)/)?.[1] ?? "0");
        },
        { timeout: 15_000 },
      )
      .toBe(17);
  });
});
