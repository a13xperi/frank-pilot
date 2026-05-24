import { test, expect, seedDemo, SKIP_WRITES } from "../fixtures";

// Tenant Ledger (Ledger.tsx). The delinquency overview is open to all staff;
// "Post Rent" + "Process Late Fees" are gated minRole="system_admin". The
// ledger-detail payment/credit modals are gated minRole="senior_manager".
// Reads run anywhere; the batch postings are local/CI-DB-only.

test.beforeEach(async ({ browser, baseURL }) => {
  await seedDemo(browser, baseURL);
});

test.describe("Ledger — overview rendering + action gating", () => {
  test("agent sees the delinquency overview but no posting actions", async ({ agentPage }) => {
    await agentPage.goto("/ledger");
    const main = agentPage.getByRole("main");
    await expect(main.getByRole("heading", { name: /Tenant Ledger/i })).toBeVisible();
    await expect(main.getByText("Total Owed")).toBeVisible();
    await expect(main.getByText(/Eviction Flags/i)).toBeVisible();
    await expect(main.getByRole("button", { name: /Post Rent/i })).toHaveCount(0);
    await expect(main.getByRole("button", { name: /Process Late Fees/i })).toHaveCount(0);
  });

  test("admin sees the posting actions", async ({ adminPage }) => {
    await adminPage.goto("/ledger");
    const main = adminPage.getByRole("main");
    await expect(main.getByRole("button", { name: /Post Rent/i })).toBeVisible();
    await expect(main.getByRole("button", { name: /Process Late Fees/i })).toBeVisible();
  });
});

test.describe("Ledger — admin runs the rent posting (write)", () => {
  test.skip(SKIP_WRITES, "mutating spec — local/CI DB only");

  test("Post Rent reports how many tenants were posted", async ({ adminPage }) => {
    await adminPage.goto("/ledger");
    const main = adminPage.getByRole("main");
    await main.getByRole("button", { name: /Post Rent/i }).click();
    await expect(main.getByText(/Rent posted for \d+ tenants/i)).toBeVisible();
  });
});
