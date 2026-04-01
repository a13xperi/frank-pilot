/**
 * Integration test: Tenant Onboarding Pipeline (live DB)
 *
 * Exercises the full flow against a real PostgreSQL database:
 *   Login → Create Application → Submit → Screen → Tier-1 Approve →
 *   Tier-2 Approve → Tier-3 Approve → Generate Lease → Onboard
 *
 * Requires: DATABASE_URL pointing to a seeded frank_pilot database.
 * Skip with: SKIP_INTEGRATION=1 npm test
 */

jest.setTimeout(30000);

import request from "supertest";
import { pool, query } from "../../config/database";

const SKIP =
  process.env.SKIP_INTEGRATION === "1" || !process.env.DATABASE_URL;

const describeIf = SKIP ? describe.skip : describe;

const TEST_EMAIL = "jane.doe.integration@example.com";

let app: any;

async function cleanTestData() {
  // Must disable immutable trigger to delete audit records
  await query("ALTER TABLE audit_log DISABLE TRIGGER trg_audit_log_immutable");
  await query(
    "DELETE FROM audit_log WHERE application_id IN (SELECT id FROM applications WHERE email = $1)",
    [TEST_EMAIL]
  );
  await query("ALTER TABLE audit_log ENABLE TRIGGER trg_audit_log_immutable");
  await query(
    "DELETE FROM fraud_flags WHERE application_id IN (SELECT id FROM applications WHERE email = $1)",
    [TEST_EMAIL]
  );
  await query(
    "DELETE FROM adverse_action_notices WHERE application_id IN (SELECT id FROM applications WHERE email = $1)",
    [TEST_EMAIL]
  );
  await query(
    "DELETE FROM lease_modifications WHERE application_id IN (SELECT id FROM applications WHERE email = $1)",
    [TEST_EMAIL]
  );
  await query("DELETE FROM applications WHERE email = $1", [TEST_EMAIL]);
}

describeIf("Tenant Pipeline (integration)", () => {
  let agentToken: string;
  let seniorToken: string;
  let regionalToken: string;
  let assetToken: string;
  let propertyId: string;
  let applicationId: string;

  beforeAll(async () => {
    const res = await query("SELECT 1 AS ok");
    expect(res.rows[0].ok).toBe(1);

    // Clean any leftover test data from prior runs
    await cleanTestData();

    const mod = await import("../../index");
    app = mod.default;

    const props = await query("SELECT id FROM properties LIMIT 1");
    expect(props.rows.length).toBeGreaterThan(0);
    propertyId = props.rows[0].id;
  });

  afterAll(async () => {
    await cleanTestData();
    await pool.end();
  });

  // ── Step 1: Login as each role ──────────────────────────────────────────

  test("login as leasing_agent", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "agent@cdpc.test", password: "password123" });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    agentToken = res.body.token;
  });

  test("login as senior_manager", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "senior@cdpc.test", password: "password123" });
    expect(res.status).toBe(200);
    seniorToken = res.body.token;
  });

  test("login as regional_manager", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "regional@cdpc.test", password: "password123" });
    expect(res.status).toBe(200);
    regionalToken = res.body.token;
  });

  test("login as asset_manager", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "asset@cdpc.test", password: "password123" });
    expect(res.status).toBe(200);
    assetToken = res.body.token;
  });

  // ── Step 2: Create application (draft) ──────────────────────────────────

  test("create tenant application", async () => {
    const res = await request(app)
      .post("/api/applications")
      .set("Authorization", `Bearer ${agentToken}`)
      .send({
        propertyId,
        unitNumber: "A-101",
        firstName: "Jane",
        lastName: "Doe",
        ssn: "987-65-4321",
        dateOfBirth: "1990-05-15",
        phone: "702-555-0100",
        email: TEST_EMAIL,
        currentAddressLine1: "100 Test Blvd",
        currentCity: "Las Vegas",
        currentState: "NV",
        currentZip: "89101",
        annualIncome: 32000,
        employerName: "Test Corp",
        householdSize: 2,
        requestedMoveInDate: "2026-05-01",
        requestedLeaseTermMonths: 12,
        requestedRentAmount: 950,
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.status).toBe("draft");
    applicationId = res.body.id;
  });

  // ── Step 3: Submit application ──────────────────────────────────────────

  test("submit application", async () => {
    const res = await request(app)
      .post(`/api/applications/${applicationId}/submit`)
      .set("Authorization", `Bearer ${agentToken}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("submitted");
  });

  // ── Step 4: Run screening (senior_manager+) ─────────────────────────────

  test("run screening pipeline", async () => {
    const res = await request(app)
      .post(`/api/screening/${applicationId}/screen`)
      .set("Authorization", `Bearer ${seniorToken}`);

    if (res.status !== 200) console.error("Screening failed:", res.body);
    expect(res.status).toBe(200);
    expect(res.body.overallResult).toBe("pass");
  });

  // ── Step 5: Tier-1 approval (Senior Manager) ───────────────────────────

  test("tier-1 approval by senior_manager", async () => {
    const res = await request(app)
      .post(`/api/approvals/${applicationId}/tier1`)
      .set("Authorization", `Bearer ${seniorToken}`)
      .send({ decision: "pass", notes: "Integration test tier 1" });

    if (res.status !== 200) console.error("Tier-1 failed:", res.body);
    expect(res.status).toBe(200);
  });

  // ── Step 6: Tier-2 approval (Regional Manager) ─────────────────────────

  test("tier-2 approval by regional_manager", async () => {
    const res = await request(app)
      .post(`/api/approvals/${applicationId}/tier2`)
      .set("Authorization", `Bearer ${regionalToken}`)
      .send({ decision: "pass", notes: "Integration test tier 2" });

    if (res.status !== 200) console.error("Tier-2 failed:", res.body);
    expect(res.status).toBe(200);
  });

  // ── Step 7: Tier-3 approval (Asset Manager) ────────────────────────────

  test("tier-3 final approval by asset_manager", async () => {
    const res = await request(app)
      .post(`/api/approvals/${applicationId}/tier3`)
      .set("Authorization", `Bearer ${assetToken}`)
      .send({ decision: "pass", notes: "Integration test final" });

    if (res.status !== 200) console.error("Tier-3 failed:", res.body);
    expect(res.status).toBe(200);
  });

  // ── Step 7b: Verify income (LIHTC §42 gate) ─────────────────────────────

  test("verify income for LIHTC compliance", async () => {
    const res = await request(app)
      .patch(`/api/applications/${applicationId}/verify-income`)
      .set("Authorization", `Bearer ${seniorToken}`)
      .send({ verifiedIncome: 32000 });

    if (res.status !== 200) console.error("Income verify failed:", res.body);
    expect(res.status).toBe(200);
  });

  // ── Step 8: Generate lease (senior_manager+) ────────────────────────────

  test("generate lease document", async () => {
    const res = await request(app)
      .post(`/api/leases/${applicationId}/generate`)
      .set("Authorization", `Bearer ${seniorToken}`);

    if (res.status !== 200) console.error("Lease gen failed:", res.body);
    expect(res.status).toBe(200);
  });

  // ── Step 9: Onboard tenant (senior_manager+) ───────────────────────────

  test("onboard tenant", async () => {
    const res = await request(app)
      .post(`/api/leases/${applicationId}/onboard`)
      .set("Authorization", `Bearer ${seniorToken}`);

    if (res.status !== 200) console.error("Onboard failed:", res.body);
    expect(res.status).toBe(200);
    expect(res.body.onboarded).toBe(true);
  });

  // ── Step 10: Verify audit trail ─────────────────────────────────────────

  test("audit trail has entries for full pipeline", async () => {
    const res = await request(app)
      .get(`/api/audit?applicationId=${applicationId}`)
      .set("Authorization", `Bearer ${assetToken}`);

    expect(res.status).toBe(200);
    expect(res.body.logs.length).toBeGreaterThanOrEqual(5);
  });

  // ── Step 11: Verify final DB state ──────────────────────────────────────

  test("application is onboarded in database", async () => {
    const res = await query(
      "SELECT status FROM applications WHERE id = $1",
      [applicationId]
    );
    expect(res.rows[0].status).toBe("onboarded");
  });
});
