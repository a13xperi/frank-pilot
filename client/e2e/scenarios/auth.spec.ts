import { test, expect } from "../fixtures";

// Login form (the real password flow staff use) + route protection.

test.describe("Auth", () => {
  test("unauthenticated visit redirects to /login", async ({ page }) => {
    await page.goto("/");
    await page.waitForURL(/\/login/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: /CDPC Compliance Hub/i })).toBeVisible();
  });

  test("signing in via the form lands on the dashboard", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill("senior@cdpc.test");
    await page.getByLabel(/password/i).fill("password123");
    await page.getByRole("button", { name: /sign in/i }).click();

    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible();
  });

  test("bad credentials surface an inline error", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill("senior@cdpc.test");
    await page.getByLabel(/password/i).fill("wrong-password");
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect(page.getByText(/invalid credentials/i)).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });
});
