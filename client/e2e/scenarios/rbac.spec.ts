import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";

// RBAC matrix — positive + negative. Drives off the NAV_ITEMS minRole gates in
// client/src/components/Sidebar.tsx and the per-page / per-button RoleGate
// wrappers. Asserts each role sees exactly the nav items it should, that
// under-privileged deep-links render the "Access denied" guard, and that gated
// action buttons are absent for roles below their threshold. Pure reads — safe
// against a deployed env, so no SKIP_WRITES guard and no seeding needed.

const ALL_NAV = [
  "Dashboard",
  "Applications",
  "Screening",
  "Approvals",
  "Ledger",
  "Properties",
  "Users",
  "Inspections",
  "Maintenance",
  "Renewals",
  "Move-Outs",
  "Evictions",
  "Recertifications",
  "Compliance",
  "Audit Log",
  "QA Bundles",
] as const;

// Exact set of sidebar items each role should see (cumulative by hierarchy).
const AGENT_NAV = ["Dashboard", "Applications", "Ledger", "Properties", "Inspections", "Maintenance"];
const SENIOR_NAV = [...AGENT_NAV, "Screening", "Approvals", "Users", "Renewals", "Move-Outs", "Evictions", "Recertifications"];
const FULL_NAV = [...ALL_NAV];

async function assertNav(page: Page, visible: readonly string[]) {
  const nav = page.getByRole("navigation", { name: "Primary" });
  await expect(nav).toBeVisible();
  for (const label of ALL_NAV) {
    const link = nav.getByRole("link", { name: label, exact: true });
    if (visible.includes(label)) {
      await expect(link, `${label} should be visible`).toBeVisible();
    } else {
      await expect(link, `${label} should be hidden`).toHaveCount(0);
    }
  }
}

test.describe("RBAC — sidebar nav matrix", () => {
  test("leasing_agent sees only the six unrestricted pages", async ({ agentPage }) => {
    await assertNav(agentPage, AGENT_NAV);
  });

  test("senior_manager adds screening/approvals/lifecycle pages", async ({ seniorPage }) => {
    await assertNav(seniorPage, SENIOR_NAV);
  });

  test("regional_manager unlocks compliance/audit/QA — full sidebar", async ({ regionalPage }) => {
    await assertNav(regionalPage, FULL_NAV);
  });

  test("system_admin sees the full sidebar", async ({ adminPage }) => {
    await assertNav(adminPage, FULL_NAV);
  });
});

test.describe("RBAC — under-privileged deep-links show the access guard", () => {
  for (const path of ["/screening", "/approvals", "/users"]) {
    test(`agent → ${path} is denied (Senior+)`, async ({ agentPage }) => {
      await agentPage.goto(path);
      await expect(agentPage.getByText(/Access denied\. Senior Manager or above required\./i)).toBeVisible();
    });
  }

  for (const path of ["/compliance", "/audit-log", "/qa-bundles"]) {
    test(`senior → ${path} is denied (Regional+)`, async ({ seniorPage }) => {
      await seniorPage.goto(path);
      await expect(seniorPage.getByText(/Access denied\. Regional Manager or above required\./i)).toBeVisible();
    });
  }
});

test.describe("RBAC — gated action buttons", () => {
  test("agent cannot see Add Property / Post Rent / Schedule Inspection", async ({ agentPage }) => {
    await agentPage.goto("/properties");
    await expect(agentPage.getByRole("heading", { name: /^Properties$/ })).toBeVisible();
    await expect(agentPage.getByRole("button", { name: /Add Property/i })).toHaveCount(0);

    await agentPage.goto("/ledger");
    await expect(agentPage.getByRole("button", { name: /Post Rent/i })).toHaveCount(0);
    await expect(agentPage.getByRole("button", { name: /Process Late Fees/i })).toHaveCount(0);

    await agentPage.goto("/inspections");
    await expect(agentPage.getByRole("button", { name: /Schedule Inspection/i })).toHaveCount(0);
  });

  test("senior sees Schedule Inspection but not Add Property (asset+) or Post Rent (admin)", async ({ seniorPage }) => {
    await seniorPage.goto("/inspections");
    await expect(seniorPage.getByRole("button", { name: /Schedule Inspection/i })).toBeVisible();

    await seniorPage.goto("/properties");
    await expect(seniorPage.getByRole("button", { name: /Add Property/i })).toHaveCount(0);

    await seniorPage.goto("/ledger");
    await expect(seniorPage.getByRole("button", { name: /Post Rent/i })).toHaveCount(0);
  });

  test("admin sees Add Property, Post Rent, Schedule Inspection", async ({ adminPage }) => {
    await adminPage.goto("/properties");
    await expect(adminPage.getByRole("button", { name: /Add Property/i })).toBeVisible();

    await adminPage.goto("/ledger");
    await expect(adminPage.getByRole("button", { name: /Post Rent/i })).toBeVisible();

    await adminPage.goto("/inspections");
    await expect(adminPage.getByRole("button", { name: /Schedule Inspection/i })).toBeVisible();
  });
});
