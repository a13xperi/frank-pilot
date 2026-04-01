/**
 * Demo Data Seed
 * Creates applications at every pipeline stage for a full system walkthrough.
 * Can be run standalone (npm run seed:demo) or via the API endpoint.
 */

import dotenv from "dotenv";
dotenv.config();

import { pool, query } from "../config/database";
import { encrypt, hashSSN } from "../utils/encryption";

const DEMO_APPLICANTS = [
  // Draft
  { first: "Marcus", last: "Rivera", ssn: "111-22-3001", dob: "1988-03-15", income: 28000, hh: 1, unit: "A-102", rent: 850, status: "draft" },
  // Submitted (awaiting screening)
  { first: "Priya", last: "Patel", ssn: "111-22-3002", dob: "1992-07-22", income: 35000, hh: 3, unit: "B-205", rent: 1100, status: "submitted" },
  { first: "James", last: "Thornton", ssn: "111-22-3003", dob: "1985-11-08", income: 31000, hh: 2, unit: "A-110", rent: 950, status: "submitted" },
  // Screening passed (awaiting tier-1)
  { first: "Aisha", last: "Johnson", ssn: "111-22-3004", dob: "1990-01-30", income: 33000, hh: 2, unit: "C-301", rent: 1050, status: "screening_passed" },
  { first: "Carlos", last: "Mendez", ssn: "111-22-3005", dob: "1983-06-12", income: 29000, hh: 4, unit: "B-108", rent: 1200, status: "screening_passed" },
  // Tier-1 approved (awaiting tier-2 — rent > $1500)
  { first: "Lydia", last: "Zhang", ssn: "111-22-3006", dob: "1995-09-18", income: 42000, hh: 3, unit: "D-401", rent: 1600, status: "tier1_approved" },
  // Tier-2 approved (awaiting tier-3)
  { first: "David", last: "Okafor", ssn: "111-22-3007", dob: "1979-04-25", income: 38000, hh: 5, unit: "C-310", rent: 1400, status: "tier2_approved" },
  // Tier-3 approved (ready for lease)
  { first: "Elena", last: "Vasquez", ssn: "111-22-3008", dob: "1987-12-03", income: 34000, hh: 2, unit: "A-115", rent: 950, status: "tier3_approved" },
  // Lease generated
  { first: "Omar", last: "Hassan", ssn: "111-22-3009", dob: "1991-08-14", income: 30000, hh: 1, unit: "B-201", rent: 875, status: "lease_generated" },
  // Onboarded (complete)
  { first: "Keisha", last: "Williams", ssn: "111-22-3010", dob: "1986-02-27", income: 36000, hh: 4, unit: "D-405", rent: 1300, status: "onboarded" },
  { first: "Tomasz", last: "Kowalski", ssn: "111-22-3011", dob: "1993-10-09", income: 32000, hh: 2, unit: "A-120", rent: 950, status: "onboarded" },
  // Denied (with adverse action)
  { first: "Rachel", last: "Kim", ssn: "111-22-3012", dob: "1989-05-20", income: 75000, hh: 1, unit: "C-305", rent: 900, status: "tier1_denied" },
  // Cancelled
  { first: "Steven", last: "Park", ssn: "111-22-3013", dob: "1984-07-11", income: 27000, hh: 2, unit: "B-210", rent: 1000, status: "cancelled" },
];

export async function seedDemoData() {
  // Get property and user IDs
  const propResult = await query("SELECT id FROM properties LIMIT 1");
  if (propResult.rows.length === 0) throw new Error("No properties found — run base seed first");
  const propertyId = propResult.rows[0].id;

  const agentResult = await query("SELECT id FROM users WHERE role = 'leasing_agent' LIMIT 1");
  const seniorResult = await query("SELECT id FROM users WHERE role = 'senior_manager' LIMIT 1");
  const regionalResult = await query("SELECT id FROM users WHERE role = 'regional_manager' LIMIT 1");
  const assetResult = await query("SELECT id FROM users WHERE role = 'asset_manager' LIMIT 1");

  const agentId = agentResult.rows[0]?.id;
  const seniorId = seniorResult.rows[0]?.id;
  const regionalId = regionalResult.rows[0]?.id;
  const assetId = assetResult.rows[0]?.id;

  if (!agentId || !seniorId || !regionalId || !assetId) {
    throw new Error("Missing required user roles — run base seed first");
  }

  // Clean existing demo data (identifiable by SSN hash prefix pattern)
  await query("ALTER TABLE audit_log DISABLE TRIGGER trg_audit_log_immutable");
  for (const app of DEMO_APPLICANTS) {
    const ssnHash = hashSSN(app.ssn.replace(/\D/g, ""));
    const existing = await query("SELECT id FROM applications WHERE ssn_hash = $1", [ssnHash]);
    for (const row of existing.rows) {
      await query("DELETE FROM audit_log WHERE application_id = $1", [row.id]);
      await query("DELETE FROM fraud_flags WHERE application_id = $1", [row.id]);
      await query("DELETE FROM adverse_action_notices WHERE application_id = $1", [row.id]);
      await query("DELETE FROM lease_modifications WHERE application_id = $1", [row.id]);
      await query("DELETE FROM applications WHERE id = $1", [row.id]);
    }
  }
  await query("ALTER TABLE audit_log ENABLE TRIGGER trg_audit_log_immutable");

  let created = 0;

  for (const app of DEMO_APPLICANTS) {
    const rawSsn = app.ssn.replace(/\D/g, "");
    const ssnEncrypted = encrypt(rawSsn);
    const ssnHash = hashSSN(rawSsn);
    const dobEncrypted = encrypt(app.dob);

    // Build the status-specific columns
    const statusFields: Record<string, unknown> = {};

    // Submitted+
    if (app.status !== "draft") {
      statusFields.submitted_at = new Date(Date.now() - Math.random() * 7 * 86400000).toISOString();
    }

    // Screening passed+
    if (["screening_passed", "tier1_approved", "tier1_denied", "tier2_approved", "tier3_approved", "lease_generated", "onboarded"].includes(app.status)) {
      statusFields.background_check_result = "pass";
      statusFields.credit_check_result = "pass";
      statusFields.compliance_check_result = "pass";
      statusFields.overall_screening_result = "pass";
    }

    // Tier-1 approved+
    if (["tier1_approved", "tier1_denied", "tier2_approved", "tier3_approved", "lease_generated", "onboarded"].includes(app.status)) {
      statusFields.tier1_reviewer_id = seniorId;
      statusFields.tier1_decision = app.status === "tier1_denied" ? "fail" : "pass";
      statusFields.tier1_notes = app.status === "tier1_denied" ? "Income exceeds 60% AMI limit for household size" : "Application meets all criteria. Approved.";
      statusFields.tier1_decided_at = new Date(Date.now() - Math.random() * 5 * 86400000).toISOString();
    }

    // Tier-2 (required for rent > $1500 or manually triggered)
    if (["tier2_approved", "tier3_approved", "lease_generated", "onboarded"].includes(app.status) || app.rent > 1500) {
      statusFields.tier2_required = true;
      if (["tier2_approved", "tier3_approved", "lease_generated", "onboarded"].includes(app.status)) {
        statusFields.tier2_reviewer_id = regionalId;
        statusFields.tier2_decision = "pass";
        statusFields.tier2_notes = "Regional review complete. No concerns.";
        statusFields.tier2_decided_at = new Date(Date.now() - Math.random() * 3 * 86400000).toISOString();
      }
    }

    // Tier-3
    if (["tier3_approved", "lease_generated", "onboarded"].includes(app.status)) {
      statusFields.tier3_required = true;
      statusFields.tier3_reviewer_id = assetId;
      statusFields.tier3_decision = "pass";
      statusFields.tier3_notes = "Final sign-off. All documentation complete.";
      statusFields.tier3_decided_at = new Date(Date.now() - Math.random() * 2 * 86400000).toISOString();
    }

    // Income verified (for lease stages)
    if (["tier3_approved", "lease_generated", "onboarded"].includes(app.status)) {
      statusFields.income_verified = true;
      statusFields.income_verified_by = seniorId;
      statusFields.income_verified_at = new Date(Date.now() - Math.random() * 2 * 86400000).toISOString();
    }

    // Lease generated+
    if (["lease_generated", "onboarded"].includes(app.status)) {
      statusFields.onesite_lease_id = `ols_demo_${Date.now()}_${created}`;
    }

    // Onboarded
    if (app.status === "onboarded") {
      statusFields.loft_tenant_id = `lft_demo_${Date.now()}_${created}`;
      statusFields.auto_pay_enrolled = true;
    }

    // Build dynamic INSERT
    const baseCols = [
      "property_id", "unit_number",
      "first_name", "last_name", "ssn_encrypted", "ssn_hash", "date_of_birth_encrypted",
      "email", "phone", "current_address_line1", "current_city", "current_state", "current_zip",
      "employer_name", "annual_income", "household_size",
      "requested_lease_term_months", "requested_rent_amount",
      "status", "submitted_by",
    ];
    const baseVals: unknown[] = [
      propertyId, app.unit,
      app.first, app.last, ssnEncrypted, ssnHash, dobEncrypted,
      `${app.first.toLowerCase()}.${app.last.toLowerCase()}@example.com`,
      `702-555-${String(3000 + created).padStart(4, "0")}`,
      `${100 + created} Demo Blvd`, "Las Vegas", "NV", "89101",
      "Demo Employer LLC", app.income, app.hh,
      12, app.rent,
      app.status, agentId,
    ];

    // Append status-specific columns
    const extraCols = Object.keys(statusFields);
    const extraVals = Object.values(statusFields);

    const allCols = [...baseCols, ...extraCols];
    const allVals = [...baseVals, ...extraVals];
    const placeholders = allVals.map((_, i) => `$${i + 1}`).join(", ");

    await query(
      `INSERT INTO applications (${allCols.join(", ")}) VALUES (${placeholders})
       ON CONFLICT DO NOTHING`,
      allVals
    );

    created++;
    console.log(`  ${app.status.padEnd(20)} → ${app.first} ${app.last} (Unit ${app.unit})`);
  }

  // Add a fraud flag on one of the screening_passed apps
  const aishaResult = await query("SELECT id FROM applications WHERE first_name = 'Aisha' AND last_name = 'Johnson' LIMIT 1");
  if (aishaResult.rows.length > 0) {
    await query(
      `INSERT INTO fraud_flags (application_id, flag_type, description, severity)
       VALUES ($1, 'income_mismatch', 'Reported income $33,000 but employer records show $28,500 (13.6% discrepancy)', 'medium')
       ON CONFLICT DO NOTHING`,
      [aishaResult.rows[0].id]
    );
    console.log("  Fraud flag added for Aisha Johnson (income mismatch)");
  }

  // Add adverse action notice for the denied application
  const rachelResult = await query("SELECT id FROM applications WHERE first_name = 'Rachel' AND last_name = 'Kim' LIMIT 1");
  if (rachelResult.rows.length > 0) {
    await query(
      `INSERT INTO adverse_action_notices (application_id, reason, reason_detail, notice_text, sent_by)
       VALUES ($1, 'tier1_denied', 'Annual income of $75,000 exceeds 60% AMI limit of $39,900 for household size 1',
               'NOTICE OF ADVERSE ACTION — Per 15 U.S.C. §1681m, your application has been denied based on income exceeding LIHTC §42 limits.',
               $2)
       ON CONFLICT DO NOTHING`,
      [rachelResult.rows[0].id, seniorId]
    );
    console.log("  Adverse action notice added for Rachel Kim (income over AMI)");
  }

  console.log(`\nDemo seed complete! ${created} applications created across all pipeline stages.`);
  return { created };
}

// Run standalone
if (require.main === module) {
  seedDemoData()
    .then(() => pool.end())
    .catch((err) => { console.error("Demo seed failed:", err.message); pool.end(); process.exit(1); });
}
