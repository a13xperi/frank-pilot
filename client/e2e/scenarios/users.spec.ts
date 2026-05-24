import { test, expect, seedDemo, SKIP_WRITES } from "../fixtures";

// Users (Users.tsx). Page itself is gated minRole="senior_manager" (agent denial
// covered in rbac.spec). "Add User" + the deactivate/reset-password actions are
// gated minRole="system_admin". Create posts /api/users. Reads run anywhere;
// create is local/CI-DB-only.

test.beforeEach(async ({ browser, baseURL }) => {
  await seedDemo(browser, baseURL);
});

test.describe("Users — rendering + create gating", () => {
  test("senior sees the roster but not Add User", async ({ seniorPage }) => {
    await seniorPage.goto("/users");
    const main = seniorPage.getByRole("main");
    await expect(main.getByRole("heading", { name: /^Users$/ })).toBeVisible();
    await expect(main.getByRole("button", { name: "View details" }).first()).toBeVisible();
    await expect(main.getByRole("button", { name: /Add User/i })).toHaveCount(0);
  });

  test("admin sees Add User", async ({ adminPage }) => {
    await adminPage.goto("/users");
    await expect(adminPage.getByRole("main").getByRole("button", { name: /Add User/i })).toBeVisible();
  });
});

test.describe("Users — admin creates a staff user (write)", () => {
  test.skip(SKIP_WRITES, "mutating spec — local/CI DB only");

  test("create a leasing_agent and see it in the roster", async ({ adminPage }) => {
    const email = `e2e.user.${Date.now()}@cdpc.test`;
    await adminPage.goto("/users");
    const main = adminPage.getByRole("main");

    await main.getByRole("button", { name: /Add User/i }).click();
    const dialog = adminPage.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Labels aren't associated with inputs (no htmlFor), so target by name.
    await dialog.locator('input[name="firstName"]').fill("E2E");
    await dialog.locator('input[name="lastName"]').fill("Tester");
    await dialog.locator('input[name="email"]').fill(email);
    await dialog.locator('input[name="password"]').fill("password123");
    await dialog.locator('select[name="role"]').selectOption("leasing_agent");

    await dialog.getByRole("button", { name: /Create User/i }).click();
    await expect(dialog).toBeHidden();
    await expect(main.getByText(email)).toBeVisible();
  });
});
