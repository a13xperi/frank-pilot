import { test, expect } from "../fixtures";

// Seeded-applicant smoke. applicantA@cdpc.test is past register + verify +
// intent + claim (see src/db/seed.ts). The fixture signs them in via the
// dev magic-link bypass and deep-links to /apply?step=checklist.

test.describe("Apply — checklist (seeded applicant)", () => {
  test("seededApplicantPage lands on the checklist step with auth", async ({
    seededApplicantPage: page,
  }) => {
    await expect(page).toHaveURL(/\/apply\?step=checklist/);
    // /auth/me succeeded → applicant session present.
    const me = await page.request.get("/api/auth/me");
    expect(me.ok(), `/auth/me failed (${me.status()})`).toBeTruthy();
    const meBody = (await me.json()) as { user?: { email?: string; role?: string } };
    expect(meBody.user?.email).toBe("applicantA@cdpc.test");
    expect(meBody.user?.role).toBe("applicant");
  });

  test("seeded application carries intent + claimed unit", async ({
    seededApplicantPage: page,
  }) => {
    const apps = await page.request.get("/api/applicants/me/applications");
    expect(apps.ok(), `/applicants/me/applications failed (${apps.status()})`).toBeTruthy();
    const body = (await apps.json()) as {
      applications?: Array<{
        status?: string;
        intent_bedrooms?: number | null;
        intent_household_size?: number | null;
        requested_rent_amount?: string | null;
        property_name?: string | null;
      }>;
    };
    const draft = body.applications?.[0];
    expect(draft, "seeded applicant should have a draft application").toBeDefined();
    expect(draft?.status).toBe("draft");
    expect(draft?.intent_bedrooms).toBe(2);
    expect(draft?.intent_household_size).toBe(2);
    // B-201 of David J. Hoggard is held for this applicant at $1,194/mo.
    expect(draft?.property_name).toMatch(/Hoggard/i);
    expect(draft?.requested_rent_amount).toBe("1194.00");
  });
});
