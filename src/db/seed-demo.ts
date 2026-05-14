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
  // Get property IDs — distribute applicants across multiple properties
  const propResult = await query("SELECT id, name FROM properties ORDER BY name LIMIT 16");
  if (propResult.rows.length === 0) throw new Error("No properties found — run base seed first");
  const propertyIds = propResult.rows.map((r: any) => r.id);
  const getPropertyId = (index: number) => propertyIds[index % propertyIds.length];

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
      // Set lease_start_date ~11 months ago for recertification demo
      const leaseStart = new Date();
      leaseStart.setMonth(leaseStart.getMonth() - 11 + created);
      statusFields.lease_start_date = leaseStart.toISOString().split("T")[0];
      // Set lease_end_date (12 months from start) and security deposit
      const leaseEnd = new Date(leaseStart);
      leaseEnd.setMonth(leaseEnd.getMonth() + 12);
      statusFields.lease_end_date = leaseEnd.toISOString().split("T")[0];
      statusFields.security_deposit_amount = app.rent;
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
      getPropertyId(created), app.unit,
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

  // Create recertification records for onboarded tenants
  const onboardedResult = await query(
    `SELECT id, property_id, first_name, last_name, annual_income, lease_start_date, requested_rent_amount
     FROM applications WHERE status = 'onboarded' AND lease_start_date IS NOT NULL`
  );

  let recertCreated = 0;
  for (const app of onboardedResult.rows) {
    const leaseStart = new Date(app.lease_start_date);
    const anniversary = new Date(leaseStart.getFullYear() + 1, leaseStart.getMonth(), 1);
    const cutoff = new Date(anniversary.getFullYear(), anniversary.getMonth() - 1, 10);
    const tracsDeadline = new Date(anniversary.getFullYear(), anniversary.getMonth() + 15, 1);

    // Vary statuses for demo: first gets reminder_90 (upcoming), second gets submitted
    const statuses = ["reminder_90", "submitted", "approved"];
    const status = statuses[recertCreated % statuses.length];

    await query(
      `INSERT INTO recertifications
         (application_id, property_id, tenant_name, type, status,
          anniversary_date, cutoff_date, tracs_deadline, previous_annual_income,
          reminder_120_sent_at,
          reminder_90_sent_at,
          submitted_at, submitted_by,
          new_annual_income)
       VALUES ($1, $2, $3, 'annual', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT DO NOTHING`,
      [
        app.id,
        app.property_id,
        `${app.first_name} ${app.last_name}`,
        status,
        anniversary.toISOString().split("T")[0],
        cutoff.toISOString().split("T")[0],
        tracsDeadline.toISOString().split("T")[0],
        app.annual_income || 0,
        // 120-day reminder always sent
        new Date(Date.now() - 30 * 86400000).toISOString(),
        // 90-day reminder sent for reminder_90+ statuses
        ["reminder_90", "submitted", "approved"].includes(status)
          ? new Date(Date.now() - 20 * 86400000).toISOString()
          : null,
        // submitted_at for submitted+ statuses
        ["submitted", "approved"].includes(status)
          ? new Date(Date.now() - 10 * 86400000).toISOString()
          : null,
        ["submitted", "approved"].includes(status) ? agentId : null,
        // new income for submitted+
        ["submitted", "approved"].includes(status)
          ? parseFloat(String(app.annual_income || 0)) + 2000
          : null,
      ]
    );
    recertCreated++;
    console.log(`  Recertification (${status}) → ${app.first_name} ${app.last_name}`);
  }

  // ── Tenant Ledger Demo Data ──────────────────────────────────
  let ledgerEntries = 0;
  for (const app of onboardedResult.rows) {
    const rent = parseFloat(app.requested_rent_amount || "0");
    if (rent <= 0) continue;

    const isKeisha = app.first_name === "Keisha";
    // Post 3 months of rent backdated
    const months = [-2, -1, 0];
    let runningBalance = 0;

    for (const offset of months) {
      const d = new Date();
      d.setMonth(d.getMonth() + offset);
      const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const dueDate = `${period}-01`;

      runningBalance += rent;
      await query(
        `INSERT INTO tenant_ledger
           (application_id, property_id, entry_type, description, amount, balance_after,
            billing_period, due_date, created_at)
         VALUES ($1, $2, 'rent_charge', $3, $4, $5, $6, $7, $8)
         ON CONFLICT DO NOTHING`,
        [
          app.id, app.property_id,
          `Monthly rent — ${period}`, rent, runningBalance,
          period, dueDate,
          new Date(d.getFullYear(), d.getMonth(), 1).toISOString(),
        ]
      );
      ledgerEntries++;
    }

    if (isKeisha) {
      // Keisha: paid all 3 months → balance = 0
      for (const offset of months) {
        const d = new Date();
        d.setMonth(d.getMonth() + offset);
        const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        runningBalance -= rent;
        await query(
          `INSERT INTO tenant_ledger
             (application_id, property_id, entry_type, description, amount, balance_after,
              billing_period, reference_id, created_at)
           VALUES ($1, $2, 'payment', $3, $4, $5, $6, $7, $8)
           ON CONFLICT DO NOTHING`,
          [
            app.id, app.property_id,
            `Payment received`, -rent, runningBalance,
            period, `demo_pay_${period}`,
            new Date(d.getFullYear(), d.getMonth(), 3).toISOString(),
          ]
        );
        ledgerEntries++;
      }
      console.log(`  Ledger (current) → ${app.first_name} ${app.last_name}: balance $${runningBalance}`);
    } else {
      // Tomasz: paid 1 of 3 months → delinquent + late fee
      const firstMonth = new Date();
      firstMonth.setMonth(firstMonth.getMonth() - 2);
      const firstPeriod = `${firstMonth.getFullYear()}-${String(firstMonth.getMonth() + 1).padStart(2, "0")}`;
      runningBalance -= rent;
      await query(
        `INSERT INTO tenant_ledger
           (application_id, property_id, entry_type, description, amount, balance_after,
            billing_period, reference_id, created_at)
         VALUES ($1, $2, 'payment', $3, $4, $5, $6, $7, $8)
         ON CONFLICT DO NOTHING`,
        [
          app.id, app.property_id,
          `Payment received`, -rent, runningBalance,
          firstPeriod, `demo_pay_${firstPeriod}`,
          new Date(firstMonth.getFullYear(), firstMonth.getMonth(), 3).toISOString(),
        ]
      );
      ledgerEntries++;

      // Late fee on second month
      const lateFee = 50;
      runningBalance += lateFee;
      const secondMonth = new Date();
      secondMonth.setMonth(secondMonth.getMonth() - 1);
      const secondPeriod = `${secondMonth.getFullYear()}-${String(secondMonth.getMonth() + 1).padStart(2, "0")}`;
      await query(
        `INSERT INTO tenant_ledger
           (application_id, property_id, entry_type, description, amount, balance_after,
            billing_period, created_at)
         VALUES ($1, $2, 'late_fee', $3, $4, $5, $6, $7)
         ON CONFLICT DO NOTHING`,
        [
          app.id, app.property_id,
          `Late fee — ${secondPeriod} (6 days late)`, lateFee, runningBalance,
          secondPeriod,
          new Date(secondMonth.getFullYear(), secondMonth.getMonth(), 7).toISOString(),
        ]
      );
      ledgerEntries++;
      console.log(`  Ledger (delinquent) → ${app.first_name} ${app.last_name}: balance $${runningBalance}`);
    }
  }

  // ── Eviction Demo Data ───────────────────────────────────────
  // Add a violation + notice for delinquent Tomasz Kowalski
  const tomaszResult = await query(
    `SELECT a.id, a.property_id, a.first_name, a.last_name, a.unit_number,
            p.address_line1, p.city, p.state, p.zip
     FROM applications a JOIN properties p ON a.property_id = p.id
     WHERE a.first_name = 'Tomasz' AND a.last_name = 'Kowalski' LIMIT 1`
  );

  let evictionSeeded = 0;
  if (tomaszResult.rows.length > 0) {
    const t = tomaszResult.rows[0];
    const propertyAddr = `${t.address_line1}, ${t.city}, ${t.state} ${t.zip}`;

    // Report violation
    const violResult = await query(
      `INSERT INTO lease_violations
         (application_id, property_id, violation_type, status, description, occurred_at,
          reported_by, is_material_breach, notice_served_at, cure_deadline)
       VALUES ($1, $2, 'nonpayment', 'notice_served', 'Nonpayment of rent for 2 consecutive months. Tenant has 4+ late payments in rolling 12-month period, triggering eviction eligibility.',
               CURRENT_DATE - INTERVAL '10 days', $3, false,
               CURRENT_DATE - INTERVAL '3 days', CURRENT_DATE + INTERVAL '4 days')
       RETURNING id`,
      [t.id, t.property_id, seniorId]
    );
    evictionSeeded++;

    // Generate 7-day pay-or-quit notice
    const balance = 1950; // From ledger seed
    const noticeText = [
      `SEVEN-DAY NOTICE TO PAY RENT OR QUIT`,
      `(NRS 40.253)`,
      ``,
      `Date: ${new Date(Date.now() - 3 * 86400000).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`,
      `To: ${t.first_name} ${t.last_name}`,
      `Address: ${propertyAddr}, Unit ${t.unit_number}`,
      ``,
      `You are hereby notified that you are in default in the payment of rent in the amount of $${balance.toFixed(2)}.`,
      ``,
      `Within SEVEN (7) JUDICIAL DAYS after service of this notice, you are required to either:`,
      `  1. Pay the total amount due; OR`,
      `  2. Surrender possession of the premises.`,
      ``,
      `If you fail to do either, legal proceedings will be instituted against you.`,
      ``,
      `For information about court forms, visit the Civil Law Self-Help Center at the Regional Justice Center, 200 Lewis Avenue, Las Vegas, NV 89101.`,
    ].join("\n");

    await query(
      `INSERT INTO eviction_notices
         (application_id, violation_id, notice_type, status, tenant_name, property_address,
          unit_number, amount_owed, notice_text, serve_date, expiration_date, served_by, certificate_of_mailing)
       VALUES ($1, $2, 'pay_or_quit_7day', 'served', $3, $4, $5, $6, $7,
               CURRENT_DATE - INTERVAL '3 days', CURRENT_DATE + INTERVAL '4 days', $8, true)`,
      [t.id, violResult.rows[0].id, `${t.first_name} ${t.last_name}`, propertyAddr, t.unit_number, balance, noticeText, seniorId]
    );
    evictionSeeded++;
    console.log(`  Eviction: Violation + 7-Day Notice → ${t.first_name} ${t.last_name}`);
  }

  // ── Renewal + Move-Out Demo Data ─────────────────────────────
  let renewalSeeded = 0;
  let moveoutSeeded = 0;

  // Keisha Williams: renewal offer (lease ending soon, 3% increase)
  const keishaResult = await query(
    `SELECT a.id, a.property_id, a.requested_rent_amount, a.lease_end_date
     FROM applications a WHERE a.first_name = 'Keisha' AND a.last_name = 'Williams' AND a.status = 'onboarded' LIMIT 1`
  );
  if (keishaResult.rows.length > 0) {
    const k = keishaResult.rows[0];
    const currentRent = parseFloat(k.requested_rent_amount || "0");
    const proposedRent = Math.round(currentRent * 1.03 * 100) / 100;
    const responseDeadline = k.lease_end_date
      ? new Date(new Date(k.lease_end_date).getTime() - 30 * 86400000).toISOString().split("T")[0]
      : null;

    await query(
      `INSERT INTO lease_renewals
         (application_id, property_id, status, current_rent, proposed_rent,
          rent_change_amount, proposed_term_months, offered_at, response_deadline)
       VALUES ($1, $2, 'offered', $3, $4, $5, 12, NOW() - INTERVAL '5 days', $6)
       ON CONFLICT DO NOTHING`,
      [k.id, k.property_id, currentRent, proposedRent, proposedRent - currentRent, responseDeadline]
    );
    renewalSeeded++;
    console.log(`  Renewal offer → Keisha Williams ($${currentRent} → $${proposedRent})`);
  }

  // Tomasz Kowalski: move-out (delinquent, pre-inspection done, deposit pending)
  if (tomaszResult.rows.length > 0) {
    const t2 = tomaszResult.rows[0];
    const noticeDate = new Date(Date.now() - 15 * 86400000);
    const expectedVacate = new Date(noticeDate);
    expectedVacate.setDate(expectedVacate.getDate() + 30);
    const depositDeadline = new Date(expectedVacate);
    depositDeadline.setDate(depositDeadline.getDate() + 21);

    await query(
      `INSERT INTO move_outs
         (application_id, property_id, status, notice_date, expected_vacate_date,
          forwarding_address, pre_inspection_date, pre_inspection_notes,
          deposit_amount, deposit_deadline, unpaid_rent_balance, created_by)
       VALUES ($1, $2, 'pre_inspection_complete', $3, $4,
               '789 New Address Way, Henderson, NV 89015',
               $5, 'Unit in fair condition. Minor wall damage in bedroom, carpet stains in living room. All appliances present.',
               $6, $7, $8, $9)
       ON CONFLICT DO NOTHING`,
      [
        t2.id, t2.property_id,
        noticeDate.toISOString().split("T")[0],
        expectedVacate.toISOString().split("T")[0],
        new Date(noticeDate.getTime() + 2 * 86400000).toISOString().split("T")[0],
        950, // 1 month rent as deposit
        depositDeadline.toISOString().split("T")[0],
        1950, // From ledger
        seniorId,
      ]
    );
    moveoutSeeded++;
    console.log(`  Move-out (pre-inspection complete) → Tomasz Kowalski`);
  }

  // ── Inspections + Work Orders Demo Data ──────────────────────
  // Get some properties for inspections
  const inspProps = propResult.rows.slice(0, 3);
  let inspSeeded = 0;
  let woSeeded = 0;

  for (let i = 0; i < inspProps.length; i++) {
    const p = inspProps[i];
    // Schedule a monthly inspection
    const schedDate = new Date();
    schedDate.setDate(schedDate.getDate() + 7 + i * 5);
    await query(
      `INSERT INTO inspections
         (property_id, unit_number, inspection_type, status, scheduled_date, inspector_id)
       VALUES ($1, $2, 'monthly', 'scheduled', $3, $4)
       ON CONFLICT DO NOTHING`,
      [p.id, `${String.fromCharCode(65 + i)}-101`, schedDate.toISOString().split("T")[0], seniorId]
    );
    inspSeeded++;
  }

  // Add a completed smoke detector inspection
  await query(
    `INSERT INTO inspections
       (property_id, unit_number, inspection_type, status, scheduled_date, completed_date,
        inspector_id, notes, smoke_detector_ok, hqs_compliant, follow_up_required)
     VALUES ($1, 'D-405', 'smoke_detector', 'completed', CURRENT_DATE - INTERVAL '3 days', CURRENT_DATE - INTERVAL '3 days',
             $2, 'All smoke detectors tested and functional. Batteries replaced in bedroom unit.', true, true, false)
     ON CONFLICT DO NOTHING`,
    [inspProps[0].id, seniorId]
  );
  inspSeeded++;
  console.log(`  Inspections: ${inspSeeded} scheduled/completed`);

  // Emergency work order (plumbing leak)
  await query(
    `INSERT INTO work_orders
       (property_id, unit_number, title, description, priority, status, category,
        is_emergency, submitted_by)
     VALUES ($1, 'B-205', 'Emergency: Plumbing leak in bathroom', 'Tenant reports water leaking from bathroom ceiling into unit below. Appears to be burst pipe above shower.',
             'emergency', 'submitted', 'plumbing_leak', true, $2)
     ON CONFLICT DO NOTHING`,
    [inspProps[0].id, agentId]
  );
  woSeeded++;

  // Routine work order (assigned)
  await query(
    `INSERT INTO work_orders
       (property_id, unit_number, title, description, priority, status, category,
        is_emergency, submitted_by, assigned_to, assigned_at)
     VALUES ($1, 'C-301', 'Garbage disposal not working', 'Tenant reports garbage disposal makes grinding noise but does not function. Kitchen sink drains slowly.',
             'routine', 'assigned', 'appliance_repair', false, $2, $3, NOW() - INTERVAL '1 day')
     ON CONFLICT DO NOTHING`,
    [inspProps[1].id, agentId, seniorId]
  );
  woSeeded++;

  // Completed work order
  await query(
    `INSERT INTO work_orders
       (property_id, unit_number, title, description, priority, status, category,
        is_emergency, submitted_by, assigned_to, assigned_at, completed_at, completed_by,
        completion_notes, actual_cost)
     VALUES ($1, 'A-110', 'Replace broken window lock', 'Window lock on bedroom window is broken. Cannot secure window.',
             'urgent', 'completed', 'general_repair', false, $2, $3, NOW() - INTERVAL '3 days',
             NOW() - INTERVAL '1 day', $3, 'Replaced window lock mechanism. Window now locks and unlocks properly. Tested from both inside and outside.', 45.00)
     ON CONFLICT DO NOTHING`,
    [inspProps[2].id, agentId, seniorId]
  );
  woSeeded++;
  console.log(`  Work orders: ${woSeeded} (1 emergency, 1 assigned, 1 completed)`);

  console.log(`\nDemo seed complete! ${created} applications + ${recertCreated} recertifications + ${ledgerEntries} ledger entries + ${evictionSeeded} eviction + ${renewalSeeded} renewals + ${moveoutSeeded} move-outs + ${inspSeeded} inspections + ${woSeeded} work orders created.`);
  return { created };
}

// Run standalone
if (require.main === module) {
  seedDemoData()
    .then(() => pool.end())
    .catch((err) => { console.error("Demo seed failed:", err.message); pool.end(); process.exit(1); });
}
