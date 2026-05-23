import { test, expect } from "../fixtures";

// Apply state persistence / resume — seeded applicant (Lane D).
//
// applicantA@cdpc.test is past register + verify + intent + claim (see
// src/db/seed.ts). The `seededApplicantPage` fixture signs them in via the
// dev magic-link bypass, lifts the Bearer token onto page.request, and
// deep-links to /apply?step=checklist.
//
// These tests are PURELY read/state — they reload, deep-link, and read the
// API. They never POST, mutate, or delete the seeded application. The seeded
// draft is: intent_bedrooms=2, intent_household_size=2, claimed Hoggard B-201
// at requested_rent_amount "1194.00", status "draft".
//
// Routing facts established by reading src/pages/Apply.tsx:
//   • parseStep(null) → 1, so bare `/apply` (no `?step=`) renders Step1Register
//     (the register form), NOT a server-driven resume to a later step. There is
//     no redirect-to-furthest-step logic in this router. We assert exactly that.
//   • `?step=checklist` renders <StepChecklist /> directly. The checklist is a
//     static informational step ("Before you apply"); the claimed unit
//     (ClaimedUnitHeader) only renders on `step === 2`, NOT on the checklist.
//     So the claimed unit is asserted via the API, the checklist via its UI.
//   • On checklist (and intent/pick/2) the router fires a best-effort hydration
//     fetch of /auth/me + /applicants/me/applications — i.e. state is
//     server-hydrated, so a reload cannot lose it.

const CHECKLIST_TITLE = /Before you apply/i;

type MeResponse = { user?: { email?: string; role?: string } };
type AppsResponse = {
  applications?: Array<{
    status?: string;
    intent_bedrooms?: number | null;
    intent_household_size?: number | null;
    requested_rent_amount?: string | null;
    property_name?: string | null;
  }>;
};

async function readMe(page: import("@playwright/test").Page): Promise<MeResponse> {
  const res = await page.request.get("/api/auth/me");
  expect(res.ok(), `/auth/me failed (${res.status()})`).toBeTruthy();
  return (await res.json()) as MeResponse;
}

async function readApplications(
  page: import("@playwright/test").Page,
): Promise<AppsResponse> {
  const res = await page.request.get("/api/applicants/me/applications");
  expect(
    res.ok(),
    `/applicants/me/applications failed (${res.status()})`,
  ).toBeTruthy();
  return (await res.json()) as AppsResponse;
}

function assertSeededDraft(body: AppsResponse): void {
  const draft = body.applications?.[0];
  expect(draft, "seeded applicant should have a draft application").toBeDefined();
  expect(draft?.status).toBe("draft");
  expect(draft?.intent_bedrooms).toBe(2);
  expect(draft?.intent_household_size).toBe(2);
  // B-201 of David J. Hoggard, held for this applicant at $1,194/mo.
  expect(draft?.property_name).toMatch(/Hoggard/i);
  expect(draft?.requested_rent_amount).toBe("1194.00");
}

test.describe("Apply — resume / state persistence (seeded applicant)", () => {
  test("reload preserves checklist + server-hydrated draft", async ({
    seededApplicantPage: page,
  }) => {
    // Pre-reload: on the checklist, UI title present.
    await expect(page).toHaveURL(/\/apply\?step=checklist/);
    await expect(page.getByRole("heading", { name: CHECKLIST_TITLE })).toBeVisible();

    // Pre-reload: API still has the seeded draft.
    assertSeededDraft(await readApplications(page));

    // Reload — state lives server-side, so the checklist must re-render and the
    // draft must be byte-identical afterwards.
    await page.reload();

    await expect(page).toHaveURL(/\/apply\?step=checklist/);
    await expect(page.getByRole("heading", { name: CHECKLIST_TITLE })).toBeVisible();

    // Post-reload: same draft (intent + claimed Hoggard unit + rent) intact.
    assertSeededDraft(await readApplications(page));
  });

  test("API consistency across reload (/auth/me + /applications)", async ({
    seededApplicantPage: page,
  }) => {
    // Before reload.
    const meBefore = await readMe(page);
    expect(meBefore.user?.email).toBe("applicantA@cdpc.test");
    expect(meBefore.user?.role).toBe("applicant");
    assertSeededDraft(await readApplications(page));

    await page.reload();
    await expect(page.getByRole("heading", { name: CHECKLIST_TITLE })).toBeVisible();

    // After reload — identity + draft unchanged.
    const meAfter = await readMe(page);
    expect(meAfter.user?.email).toBe("applicantA@cdpc.test");
    expect(meAfter.user?.role).toBe("applicant");
    assertSeededDraft(await readApplications(page));
  });

  test("bare /apply (no step) lands on the register step, not a resume", async ({
    seededApplicantPage: page,
  }) => {
    // Verified in Apply.tsx: parseStep(null) → 1 (Step1Register). This router
    // has NO furthest-step resume; navigating to /apply with no `?step=` lands
    // the user on the register form regardless of their draft state. Assert the
    // verified behavior, not a hypothetical resume.
    await page.goto("/apply");
    await expect(page).toHaveURL(/\/apply(\?.*)?$/);
    await expect(page).not.toHaveURL(/step=/);
    // Register step shows the first-name / last-name identity fields.
    await expect(page.getByLabel(/first name/i)).toBeVisible();
    await expect(page.getByLabel(/last name/i)).toBeVisible();

    // The session is still valid even though the UI shows register — the draft
    // is reachable via the API (state is not lost by visiting bare /apply).
    assertSeededDraft(await readApplications(page));
  });

  test("deep-link to pick without in-memory intent redirects to intent (sane)", async ({
    seededApplicantPage: page,
  }) => {
    // StepPick has a mount-time guard (StepPick.tsx:102-105): it calls
    // setStep('intent') when the wizard's in-memory intentBedrooms is null or
    // intentMoveInDate is unset. On a COLD deep-link to `?step=pick` that guard
    // fires before the async draft-hydration fetch resolves, so the user is
    // redirected to `intent` — a sane in-funnel fallback, NOT a crash and NOT a
    // bounce all the way back to register (step 1). Lock that real behavior.
    await page.goto("/apply?step=pick");
    await expect(page).toHaveURL(/\/apply\?step=intent/);
    // Did NOT fall back to the register step: identity fields are absent on the
    // intent step (they only appear on Step1Register).
    await expect(page.getByLabel(/first name/i)).toHaveCount(0);
    // Session + draft remain intact after the deep-link + redirect.
    assertSeededDraft(await readApplications(page));
  });

  // ── Mobile @mobile ─────────────────────────────────────────────────────────
  // playwright.config.ts has only a `chromium` (Desktop Chrome) project — there
  // is NO mobile-chrome project with @mobile grep routing (same situation as
  // discover-map.spec.ts). So we set a Pixel-5-sized viewport manually and tag
  // @mobile for when a mobile project lands. Light, shell-agnostic check:
  // the checklist content is visible and not horizontally clipped.
  test("checklist renders usably at mobile width @mobile", async ({
    seededApplicantPage: page,
  }) => {
    await page.setViewportSize({ width: 393, height: 851 });
    await page.goto("/apply?step=checklist");

    const title = page.getByRole("heading", { name: CHECKLIST_TITLE });
    await expect(title).toBeVisible();

    // Not horizontally clipped: the document's scroll width should not exceed
    // the viewport width by more than a 1px rounding margin.
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
