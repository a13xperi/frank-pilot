import { test, expect, seedDemo, SKIP_WRITES } from "../fixtures";

// Properties (Properties.tsx). "Add Property" is gated minRole="asset_manager".
// Create posts /api/properties; rows are clickable into an edit modal. Reads run
// anywhere; create is local/CI-DB-only.

test.beforeEach(async ({ browser, baseURL }) => {
  await seedDemo(browser, baseURL);
});

test.describe("Properties — rendering", () => {
  test("the property list renders for any staff", async ({ agentPage }) => {
    await agentPage.goto("/properties");
    const main = agentPage.getByRole("main");
    await expect(main.getByRole("heading", { name: /^Properties$/ })).toBeVisible();
    await expect(main.getByRole("button", { name: "View details" }).first()).toBeVisible();
  });
});

test.describe("Properties — create is gated to asset_manager+", () => {
  test("senior cannot see Add Property", async ({ seniorPage }) => {
    await seniorPage.goto("/properties");
    await expect(seniorPage.getByRole("button", { name: /Add Property/i })).toHaveCount(0);
  });

  test.describe("write", () => {
    test.skip(SKIP_WRITES, "mutating spec — local/CI DB only");

    test("asset_manager creates a property and it appears in the list", async ({ assetPage }) => {
      const name = `E2E Commons ${Date.now()}`;
      await assetPage.goto("/properties");
      const main = assetPage.getByRole("main");

      await main.getByRole("button", { name: /Add Property/i }).click();
      const dialog = assetPage.getByRole("dialog");
      await expect(dialog).toBeVisible();

      // Inputs carry `name` attrs but labels aren't associated (no htmlFor), so
      // target by name.
      await dialog.locator('input[name="name"]').fill(name);
      await dialog.locator('input[name="addressLine1"]').fill("100 Test Way");
      await dialog.locator('input[name="city"]').fill("Reno");
      await dialog.locator('input[name="state"]').fill("NV");
      await dialog.locator('input[name="zip"]').fill("89501");
      await dialog.locator('input[name="unitCount"]').fill("24");
      await dialog.locator('input[name="amiArea"]').fill("Reno-Sparks MSA");

      await dialog.getByRole("button", { name: /Create Property/i }).click();
      await expect(dialog).toBeHidden();
      await expect(main.getByText(name)).toBeVisible();
    });
  });
});
