import { test, expect } from "../fixtures";

// Full apply funnel as a real Playwright spec — promotes the bash
// scripts/qa-apply-handoff.mjs flow (Welcome→register→magic-link→Intent→
// Checklist→Pick→Claim) into the harness.
//
// The `applicantPage` fixture already does fresh-register + dev-magic-link
// verify and parks the page at /apply?step=intent with auth lifted onto
// page.request. From there we drive the REMAINING screens in the UI:
//   intent (5-question quiz) → checklist → pick (claim a unit)
// and assert the claim landed via /api/applicants/me/applications.
//
// SERIAL-safe: each run registers a fresh qa+<ts>@example.com user via the
// fixture, so no shared-state collisions. We never touch applicantA@cdpc.test.

type MeApplication = {
  status?: string;
  intent_bedrooms?: number | null;
  intent_household_size?: number | null;
  intent_budget_max?: string | number | null;
  requested_rent_amount?: string | null;
  property_name?: string | null;
  property_id?: string | null;
  unit_number?: string | null;
};

// Intent choices the test drives. bedrooms 1 → the "1 BR" button (label from
// i18n intent.br.1). household 2 → the #intentHousehold <select>. move-in is a
// fixed future date so the unit-availability filter never excludes everything;
// StepPick also progressively relaxes constraints, so a unit always surfaces.
const WANT_BEDROOMS = 1;
const WANT_HOUSEHOLD = 2;
const MOVE_IN_DATE = "2030-01-01"; // YYYY-MM-DD, far enough out to match any unit

test.describe("Apply — full funnel (fresh applicant)", () => {
  test("intent → checklist → pick → claim lands a unit on the draft", async ({
    applicantPage: page,
  }) => {
    // Fixture parks us at the intent step.
    await expect(page).toHaveURL(/\/apply\?step=intent/);

    // --- Intent step (StepIntent.tsx) -------------------------------------
    // Bedrooms is a row of <button type="button"> with i18n labels
    // (Studio / 1 BR / 2 BR / 3 BR / 4+ BR). Click "1 BR".
    await page.getByRole("button", { name: /^1 BR$/ }).click();

    // Target move-in is <input id="intentMoveIn" type="date" required>.
    await page.locator("#intentMoveIn").fill(MOVE_IN_DATE);

    // Household size is <select id="intentHousehold"> (1–8).
    await page.locator("#intentHousehold").selectOption(String(WANT_HOUSEHOLD));

    // Budget is a range slider (#budget, default 2000); leave the default.
    // Income (AMI) is optional; leave blank to keep the path simple.

    // Submit — button label is intent.submit = "Show me units". Wait for the
    // POST /intent to land before asserting the step transition.
    const intentResp = page.waitForResponse(
      (r) => r.url().includes("/applicants/intent") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: /show me units/i }).click();
    const intentRes = await intentResp;
    expect(intentRes.ok(), `POST /intent failed (${intentRes.status()})`).toBeTruthy();

    // StepIntent.handleSubmit calls setStep('checklist') on success.
    await expect(page).toHaveURL(/\/apply\?step=checklist/);

    // --- Checklist step (StepChecklist.tsx) -------------------------------
    // Single CTA: checklist.continue = "I have these — continue" → setStep('pick').
    await page.getByRole("button", { name: /i have these.*continue/i }).click();
    await expect(page).toHaveURL(/\/apply\?step=pick/);

    // --- Pick step (StepPick.tsx → UnitCard.tsx) --------------------------
    // Each UnitCard renders a "Claim this unit" CTA (hardcoded English in
    // UnitCard.tsx — not i18n). Wait for the units to load, then claim the
    // first card. handleClaim POSTs /claim-unit/:id and setStep('claim').
    const claimButtons = page.getByRole("button", { name: /claim this unit/i });
    await expect(claimButtons.first()).toBeVisible({ timeout: 15_000 });

    const claimResp = page.waitForResponse(
      (r) =>
        /\/applicants\/claim-unit\//.test(r.url()) && r.request().method() === "POST",
    );
    await claimButtons.first().click();
    const claimRes = await claimResp;
    expect(claimRes.ok(), `POST /claim-unit failed (${claimRes.status()})`).toBeTruthy();

    // Claim response carries the enriched unit (unit_number, property_name, rent).
    const claimBody = (await claimRes.json()) as {
      unit?: {
        unit_number?: string;
        property_name?: string;
        monthly_rent?: string | number;
        bedrooms?: number;
      };
    };
    const claimedUnitNumber = claimBody.unit?.unit_number;
    const claimedPropertyName = claimBody.unit?.property_name;
    expect(claimedUnitNumber, "claim response should carry a unit_number").toBeTruthy();
    expect(claimedPropertyName, "claim response should carry a property_name").toBeTruthy();

    // StepPick.handleClaim → setStep('claim'); StepClaim renders the held unit.
    await expect(page).toHaveURL(/\/apply\?step=claim/);

    // --- Assert via the API that the draft now reflects intent + claim -----
    const apps = await page.request.get("/api/applicants/me/applications");
    expect(apps.ok(), `/applicants/me/applications failed (${apps.status()})`).toBeTruthy();
    const body = (await apps.json()) as { applications?: MeApplication[] };
    const draft = body.applications?.[0];
    expect(draft, "fresh applicant should have a draft application after claiming").toBeDefined();

    // Intent values written by POST /intent.
    expect(draft?.status).toBe("draft");
    expect(draft?.intent_bedrooms).toBe(WANT_BEDROOMS);
    expect(draft?.intent_household_size).toBe(WANT_HOUSEHOLD);

    // Claim values: property_name on the draft must match the unit we claimed.
    // NOTE: /claim-unit/:id sets property_id + claimed_unit_id but does NOT set
    // requested_rent_amount (that is populated later, at /apply submit) — so we
    // assert property/unit identity here, not the rent column.
    expect(draft?.property_name).toBe(claimedPropertyName);
  });

  test("intent rejects an out-of-range household size", async ({
    applicantPage: page,
  }) => {
    // The household <select> only offers 1–8, so the UI can't submit an
    // out-of-range value through the control. We exercise the API contract
    // directly (household_size must be 1–12, integer) using the page's
    // authenticated request context — proving the backed validation that the
    // UI relies on. household_size = 0 is below the schema min.
    const res = await page.request.post("/api/applicants/intent", {
      data: {
        bedrooms: 1,
        budget_max: 2000,
        move_in_date: MOVE_IN_DATE,
        household_size: 0, // invalid: schema requires int 1–12
      },
    });
    expect(
      res.status(),
      `out-of-range household_size should be rejected, got ${res.status()}`,
    ).toBe(400);
  });
});
