import dotenv from "dotenv";
dotenv.config();

import { pool, query } from "../config/database";
import bcrypt from "bcrypt";
import { seedBuildings } from "./seed-buildings";

// ── Unit status distribution ─────────────────────────────────────────────────
// Target: 70% available / 20% leased / 10% held
// Uses (i % 10) for a fully deterministic, Math.random-free pattern that repeats
// uniformly across every property + bedroom-type loop. Indices 0-6 → available,
// 7-8 → leased, 9 → held. A post-seed assertion (below) verifies actual
// percentages stay within ±5 pp of these targets and will throw if they drift.
function unitStatus(i: number): "available" | "leased" | "held" {
  const bucket = i % 10;
  if (bucket < 7) return "available"; // 0-6 → 70%
  if (bucket < 9) return "leased";    // 7-8 → 20%
  return "held";                      // 9   → 10%
}

async function seed() {
  console.log("Seeding database...");

  try {
    // Create test users (one for each role)
    const passwordHash = await bcrypt.hash("password123", 10);

    const users = [
      { email: "agent@cdpc.test", firstName: "Maria", lastName: "Lopez", role: "leasing_agent" },
      { email: "senior@cdpc.test", firstName: "James", lastName: "Wilson", role: "senior_manager" },
      { email: "regional@cdpc.test", firstName: "Sarah", lastName: "Chen", role: "regional_manager" },
      { email: "asset@cdpc.test", firstName: "Robert", lastName: "Taylor", role: "asset_manager" },
      { email: "admin@cdpc.test", firstName: "System", lastName: "Admin", role: "system_admin" },
    ];

    for (const user of users) {
      await query(
        `INSERT INTO users (email, password_hash, first_name, last_name, role)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (email) DO NOTHING`,
        [user.email, passwordHash, user.firstName, user.lastName, user.role]
      );
      console.log(`  User: ${user.email} (${user.role})`);
    }

    // ── Real GPMG (Greater Las Vegas) catalog — 17 properties ───────
    // Source: operator-supplied list (2026-05-22), real names/addresses/phones/emails.
    // Unit mixes are reasonable allocations (Studio+1BR for senior, 1BR–4BR for family)
    // that sum to unit_count; refine when GPMG provides their actual unit breakdowns.
    const AMI = "Las Vegas-Henderson-Paradise, NV MSA";
    const MGR = "GPMG Property Management"; // org-level (individual managers TBD)
    const properties = [
      {
        name: "Aldene Kline Barlow Senior Apartments", addressLine1: "1327 H St", city: "Las Vegas", zip: "89106",
        unitCount: 39, phone: "702-920-6550", email: "barlow@gpmglv.org", propertyManager: MGR,
        propertyType: "senior", jurisdiction: "Las Vegas", totalVacancy: 1, waitingListEnabled: true,
        unitMix: { "Studio": 10, "1BR": 29 },
        rentSchedule: { "Studio_60AMI": 747, "1BR_60AMI": 995 },
      },
      {
        name: "David J. Hoggard Family Community", addressLine1: "1100 W Monroe Ave", city: "Las Vegas", zip: "89106",
        unitCount: 100, phone: "702-631-2281", email: "hoggard@gpmglv.org", propertyManager: MGR,
        propertyType: "family", jurisdiction: "Las Vegas", totalVacancy: 6, waitingListEnabled: false,
        unitMix: { "1BR": 20, "2BR": 40, "3BR": 30, "4BR": 10 },
        rentSchedule: { "1BR_60AMI": 995, "2BR_60AMI": 1194, "3BR_60AMI": 1380, "4BR_60AMI": 1539 },
      },
      {
        name: "Donna Louise Apartments", addressLine1: "6225 Donna St", city: "North Las Vegas", zip: "89081",
        unitCount: 48, phone: "702-920-6548", email: "donnalouise@gpmglv.org", propertyManager: MGR,
        propertyType: "family", jurisdiction: "North Las Vegas", totalVacancy: 2, waitingListEnabled: false,
        unitMix: { "1BR": 12, "2BR": 24, "3BR": 12 },
        rentSchedule: { "1BR_60AMI": 995, "2BR_60AMI": 1194, "3BR_60AMI": 1380 },
      },
      {
        // Donna Louise 2 = the 2025 new-build at 6275 Donna St (Assessor APN 124-26-103-002,
        // DONNA LOUISE 2 LLC), a SEPARATE parcel from DL1. unitMix/rents below are DL1
        // placeholders pending GPM's real DL2 breakdown; prod loads via onboard-property.ts.
        name: "Donna Louise Apartments 2", addressLine1: "6275 Donna St", city: "North Las Vegas", zip: "89081",
        unitCount: 48, phone: "702-920-6548", email: "donnalouise@gpmglv.org", propertyManager: MGR,
        propertyType: "family", jurisdiction: "North Las Vegas", totalVacancy: 2, waitingListEnabled: false,
        unitMix: { "1BR": 12, "2BR": 24, "3BR": 12 },
        rentSchedule: { "1BR_60AMI": 995, "2BR_60AMI": 1194, "3BR_60AMI": 1380 },
      },
      {
        name: "Luther Mack, Jr. Senior Apartments", addressLine1: "8158 Giles St", city: "Las Vegas", zip: "89123",
        unitCount: 48, phone: "702-920-6569", email: "drluthermack@gpmglv.org", propertyManager: MGR,
        propertyType: "senior", jurisdiction: "Las Vegas", totalVacancy: 1, waitingListEnabled: true,
        unitMix: { "Studio": 12, "1BR": 36 },
        rentSchedule: { "Studio_60AMI": 747, "1BR_60AMI": 995 },
      },
      {
        name: "Dr. Paul Meacham Senior Community", addressLine1: "65 E Windmill Ln", city: "Las Vegas", zip: "89123",
        unitCount: 57, phone: "877-895-8207", email: "paulmeacham@gpmglv.org", propertyManager: MGR,
        propertyType: "senior", jurisdiction: "Las Vegas", totalVacancy: 1, waitingListEnabled: true,
        unitMix: { "Studio": 15, "1BR": 42 },
        rentSchedule: { "Studio_60AMI": 747, "1BR_60AMI": 995 },
      },
      {
        name: "Ethel Mae Fletcher Apartments", addressLine1: "1503 Laurelhurst Dr", city: "Las Vegas", zip: "89108",
        unitCount: 42, phone: "702-920-6572", email: "ethelmaefletcher@gpmglv.org", propertyManager: MGR,
        propertyType: "senior", jurisdiction: "Las Vegas", totalVacancy: 1, waitingListEnabled: true,
        unitMix: { "Studio": 10, "1BR": 32 },
        rentSchedule: { "Studio_60AMI": 747, "1BR_60AMI": 995 },
      },
      {
        name: "Ethel Mae Robinson Senior Apartments", addressLine1: "1327 H Street", city: "Las Vegas", zip: "89106",
        unitCount: 20, phone: "702-648-6800", email: "ethelmaerobinson@gpmglv.org", propertyManager: MGR,
        propertyType: "senior", jurisdiction: "Las Vegas", totalVacancy: 0, waitingListEnabled: true,
        unitMix: { "Studio": 5, "1BR": 15 },
        rentSchedule: { "Studio_60AMI": 747, "1BR_60AMI": 995 },
      },
      {
        name: "Mike O'Callaghan Legacy Apartments", addressLine1: "1502 Laurelhurst Dr", city: "Las Vegas", zip: "89108",
        unitCount: 40, phone: "725-735-7779", email: "mikeocallaghan@gpmglv.org", propertyManager: MGR,
        propertyType: "senior", jurisdiction: "Las Vegas", totalVacancy: 1, waitingListEnabled: true,
        unitMix: { "Studio": 10, "1BR": 30 },
        rentSchedule: { "Studio_60AMI": 747, "1BR_60AMI": 995 },
      },
      {
        name: "Juan Garcia Garden Apartments", addressLine1: "2851 Sunrise Ave", city: "Las Vegas", zip: "89101",
        unitCount: 52, phone: "725-735-7779", email: "juangarcia@gpmglv.org", propertyManager: MGR,
        propertyType: "family", jurisdiction: "Las Vegas", totalVacancy: 3, waitingListEnabled: false,
        unitMix: { "1BR": 12, "2BR": 26, "3BR": 14 },
        rentSchedule: { "1BR_60AMI": 995, "2BR_60AMI": 1194, "3BR_60AMI": 1380 },
      },
      {
        name: "Louise Shell Senior Apartments", addressLine1: "2101 N Martin Luther King Blvd", city: "Las Vegas", zip: "89106",
        unitCount: 100, phone: "702-648-6800", email: "louiseshell@gpmglv.org", propertyManager: MGR,
        propertyType: "senior", jurisdiction: "Las Vegas", totalVacancy: 2, waitingListEnabled: true,
        unitMix: { "Studio": 20, "1BR": 70, "2BR": 10 },
        rentSchedule: { "Studio_60AMI": 747, "1BR_60AMI": 995, "2BR_60AMI": 1194 },
      },
      {
        name: "Owens Senior Housing", addressLine1: "1626 Davis Pl", city: "North Las Vegas", zip: "89030",
        unitCount: 72, phone: "702-642-0896", email: "owens@gpmglv.org", propertyManager: MGR,
        propertyType: "senior", jurisdiction: "North Las Vegas", totalVacancy: 1, waitingListEnabled: true,
        unitMix: { "Studio": 18, "1BR": 54 },
        rentSchedule: { "Studio_60AMI": 747, "1BR_60AMI": 995 },
      },
      {
        name: "Sarann Knight Apartments", addressLine1: "1327 H Street", city: "Las Vegas", zip: "89106",
        unitCount: 82, phone: "702-538-9031", email: "sarannknight@gpmglv.org", propertyManager: MGR,
        propertyType: "senior", jurisdiction: "Las Vegas", totalVacancy: 2, waitingListEnabled: true,
        unitMix: { "Studio": 20, "1BR": 62 },
        rentSchedule: { "Studio_60AMI": 747, "1BR_60AMI": 995 },
      },
      {
        name: "Senator Harry Reid Senior Apartments", addressLine1: "328 N 11th St", city: "Las Vegas", zip: "89101",
        unitCount: 100, phone: "702-383-1091", email: "harryreid@gpmglv.org", propertyManager: MGR,
        propertyType: "senior", jurisdiction: "Las Vegas", totalVacancy: 2, waitingListEnabled: true,
        unitMix: { "Studio": 20, "1BR": 70, "2BR": 10 },
        rentSchedule: { "Studio_60AMI": 747, "1BR_60AMI": 995, "2BR_60AMI": 1194 },
      },
      {
        name: "Senator Richard Bryan Senior Apartments", addressLine1: "2651 Searles Ave", city: "Las Vegas", zip: "89101",
        unitCount: 120, phone: "702-649-3508", email: "senatorrichardbryan@gpmglv.org", propertyManager: MGR,
        propertyType: "senior", jurisdiction: "Las Vegas", totalVacancy: 3, waitingListEnabled: true,
        unitMix: { "Studio": 30, "1BR": 80, "2BR": 10 },
        rentSchedule: { "Studio_60AMI": 747, "1BR_60AMI": 995, "2BR_60AMI": 1194 },
      },
      {
        // Email not in source → derived from name slug to keep `@gpmglv.org` convention.
        name: "Smith Williams Senior Apartments", addressLine1: "575 E Lake Mead Pkwy", city: "Henderson", zip: "89015",
        unitCount: 80, phone: "702-382-3726", email: "smithwilliams@gpmglv.org", propertyManager: MGR,
        propertyType: "senior", jurisdiction: "Henderson", totalVacancy: 2, waitingListEnabled: true,
        unitMix: { "Studio": 20, "1BR": 60 },
        rentSchedule: { "Studio_60AMI": 747, "1BR_60AMI": 995 },
      },
      {
        // Email not in source → derived from name slug to keep `@gpmglv.org` convention.
        name: "Yale Keyes Senior Apartments", addressLine1: "1705 Yale Str", city: "North Las Vegas", zip: "89030",
        unitCount: 70, phone: "702-642-7758", email: "yalekeyes@gpmglv.org", propertyManager: MGR,
        propertyType: "senior", jurisdiction: "North Las Vegas", totalVacancy: 1, waitingListEnabled: true,
        unitMix: { "Studio": 18, "1BR": 52 },
        rentSchedule: { "Studio_60AMI": 747, "1BR_60AMI": 995 },
      },
    ];

    // NOTE: `properties` has no UNIQUE natural-key constraint, so a bare
    // `ON CONFLICT DO NOTHING` here never had an arbiter to match — every row
    // inserted unconditionally and re-running this seed appended all 17 again.
    // A DB-level unique key isn't viable: the statewide catalog loaded by
    // seed-property-geo.ts contains duplicate property names (and is collapsed
    // by slug-match, not a constraint), and the runtime PM-console create path
    // would also be affected. So we guard idempotency in code instead — the
    // same approach seed-property-geo.ts already uses — keying on `name`, the
    // identity the rest of this seeder (and the units lookup below) resolves on.
    const INSERT_SQL = `INSERT INTO properties
      (name, address_line1, city, state, zip, unit_count, ami_area,
       phone, email, property_manager, property_type,
       lihtc_type, ami_set_aside, compliance_period_start, compliance_period_end,
       has_lura, has_mortgage, jurisdiction,
       unit_mix, rent_schedule, total_vacancy, waiting_list_enabled)
      VALUES ($1,$2,$3,'NV',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`;

    for (const p of properties) {
      const existing = await query(
        "SELECT id FROM properties WHERE name = $1 LIMIT 1",
        [p.name]
      );
      if (existing.rows.length > 0) {
        console.log(`  Property exists, skipping: ${p.name}`);
        continue;
      }
      await query(INSERT_SQL, [
        p.name, p.addressLine1, p.city, p.zip, p.unitCount, AMI,
        p.phone, p.email, p.propertyManager, p.propertyType,
        "9% credit", "60% AMI", "2010-01-01", "2040-12-31",
        true, true, p.jurisdiction,
        JSON.stringify(p.unitMix), JSON.stringify(p.rentSchedule),
        p.totalVacancy, p.waitingListEnabled,
      ]);
      console.log(`  Property: ${p.name} (${p.unitCount} units, ${p.propertyType}, ${p.jurisdiction})`);
    }

    // Seed AMI limits for Las Vegas area (2025/2026 approximations)
    const amiData = [
      // household_size, 30%, 50%, 60%, 80%
      [1, 19950, 33250, 39900, 53200],
      [2, 22800, 38000, 45600, 60800],
      [3, 25650, 42750, 51300, 68400],
      [4, 28500, 47500, 57000, 76000],
      [5, 30780, 51300, 61560, 82080],
      [6, 33060, 55100, 66120, 88160],
    ];

    for (const [size, ami30, ami50, ami60, ami80] of amiData) {
      for (const year of [2025, 2026]) {
        await query(
          `INSERT INTO ami_limits (area, year, household_size, ami_30_percent, ami_50_percent, ami_60_percent, ami_80_percent)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (area, year, household_size) DO UPDATE
           SET ami_30_percent = $4, ami_50_percent = $5, ami_60_percent = $6, ami_80_percent = $7`,
          [AMI, year, size, ami30, ami50, ami60, ami80]
        );
      }
    }
    console.log("  AMI limits seeded for Las Vegas MSA (2025-2026)");

    // ── Units (generated from properties.unit_mix) ───────────────────
    // Letter prefix by bedroom type, floor-based unit numbering. Matches the
    // numbering convention already used in seed-demo (A-102, B-205, etc.).
    const BEDROOM_META: Record<string, { letter: string; bedrooms: number; bathrooms: number; sqft: number; floor: number }> = {
      Studio: { letter: "S", bedrooms: 0, bathrooms: 1, sqft: 450, floor: 0 },
      "1BR": { letter: "A", bedrooms: 1, bathrooms: 1, sqft: 650, floor: 1 },
      "2BR": { letter: "B", bedrooms: 2, bathrooms: 1.5, sqft: 900, floor: 2 },
      "3BR": { letter: "C", bedrooms: 3, bathrooms: 2, sqft: 1150, floor: 3 },
      "4BR": { letter: "D", bedrooms: 4, bathrooms: 2.5, sqft: 1400, floor: 4 },
    };

    const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

    let unitsCreated = 0;
    for (const p of properties) {
      const propRow = await query("SELECT id FROM properties WHERE name = $1", [p.name]);
      if (propRow.rows.length === 0) continue;
      const propertyId = propRow.rows[0].id;
      const propSlug = slug(p.name);

      for (const [mixKey, count] of Object.entries(p.unitMix)) {
        const meta = BEDROOM_META[mixKey];
        if (!meta) continue;

        const rentKey = `${mixKey}_60AMI`;
        const rent = (p.rentSchedule as unknown as Record<string, number>)[rentKey];
        if (!rent) continue;

        for (let i = 0; i < count; i++) {
          const seq = String(i + 1).padStart(2, "0");
          const unitNumber = meta.letter === "S"
            ? `S-${String(i + 1).padStart(3, "0")}`
            : `${meta.letter}-${meta.floor}${seq}`;

          // Target: 70% available / 20% leased / 10% held (see unitStatus above).
          const status = unitStatus(i);
          const photoUrl = `https://picsum.photos/seed/${propSlug}-${unitNumber}/800/600`;

          await query(
            `INSERT INTO units
               (property_id, unit_number, bedrooms, bathrooms, sqft, monthly_rent, status, photo_url, available_from)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_DATE)
             ON CONFLICT (property_id, unit_number) DO NOTHING`,
            [propertyId, unitNumber, meta.bedrooms, meta.bathrooms, meta.sqft, rent, status, photoUrl]
          );
          unitsCreated++;
        }
      }
    }
    // ── Post-seed distribution assertion ────────────────────────────────────
    // Targets: 70% available / 20% leased / 10% held (±5 pp each).
    // Throws loudly if actual percentages drift so CI catches future regressions.
    const distRows = await query(
      `SELECT status, count(*)::int AS n FROM units GROUP BY status ORDER BY status`
    );
    const distMap: Record<string, number> = {};
    let totalUnits = 0;
    for (const row of distRows.rows) {
      distMap[row.status] = row.n;
      totalUnits += row.n;
    }
    const targets: Record<string, number> = { available: 70, leased: 20, held: 10 };
    const TOLERANCE = 5; // ±5 percentage points
    const distReport = Object.entries(targets).map(([s, target]) => {
      const actual = totalUnits > 0 ? ((distMap[s] ?? 0) / totalUnits) * 100 : 0;
      const drift = Math.abs(actual - target);
      return { status: s, count: distMap[s] ?? 0, actual: actual.toFixed(1), target, drift };
    });
    const failures = distReport.filter((r) => r.drift > TOLERANCE);
    console.log(
      `  Units: ${unitsCreated} generated across ${properties.length} properties` +
      ` (${distMap.available ?? 0} available / ${distMap.leased ?? 0} leased / ${distMap.held ?? 0} held)`
    );
    if (failures.length > 0) {
      const msg = failures.map((f) =>
        `${f.status}: actual ${f.actual}% vs target ${f.target}% (drift ${f.drift.toFixed(1)} pp)`
      ).join("; ");
      throw new Error(`Seed distribution assertion failed — ${msg}. Fix unitStatus() or the seed data.`);
    }
    console.log(`  Distribution check passed: ${distReport.map((r) => `${r.status}=${r.actual}%`).join(" / ")}`);

    // ── LIHTC §42 buildings + BIN (data layer; fail-closed) ─────────────
    // Resolves properties by EXACT name; skips + logs the 5 unmapped binKeys
    // and any joinName row absent from this DB (e.g. fresh demo DB without the
    // statewide geo-seed). Never throws on a missing property — log and continue.
    try {
      await seedBuildings(query);
    } catch (err) {
      console.warn(`  Buildings seed warning: ${(err as Error).message}`);
    }

    // ── Seeded applicant: applicantA@cdpc.test (e2e harness) ───────────
    // Pre-walked through register + verify + intent + claim. Lands on
    // /checklist when signed in via dev magic-link. Additive to the staff
    // users above — smoke-apply (qa-apply-handoff.mjs) is untouched.
    const applicantEmail = "applicantA@cdpc.test";
    const applicantHash = await bcrypt.hash("password123", 10);
    const applicantRes = await query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, email_verified_at, is_active)
       VALUES ($1, $2, 'Alex', 'Applicant', 'applicant', NOW(), true)
       ON CONFLICT (email) DO UPDATE
         SET role = 'applicant', email_verified_at = NOW(), is_active = true
       RETURNING id`,
      [applicantEmail, applicantHash]
    );
    const applicantId: string = applicantRes.rows[0].id;

    // Pin the claim to a deterministic unit on the family property so the
    // applicant lands somewhere stable across re-seeds.
    const claimUnit = await query(
      `SELECT u.id, u.property_id, u.monthly_rent
         FROM units u
         JOIN properties p ON p.id = u.property_id
        WHERE p.name = 'David J. Hoggard Family Community'
          AND u.unit_number = 'B-201'
        LIMIT 1`
    );
    if (claimUnit.rows.length === 0) {
      throw new Error("Seeded applicant: expected unit B-201 on David J. Hoggard Family Community");
    }
    const unitId: string = claimUnit.rows[0].id;
    const propertyId: string = claimUnit.rows[0].property_id;
    const rent: number = Number(claimUnit.rows[0].monthly_rent);

    // Hold the unit for the seeded applicant (24h claim window keeps it
    // fresh after long pauses; the e2e harness reseeds each run anyway).
    await query(
      `UPDATE units
          SET status = 'held',
              claim_expires_at = NOW() + INTERVAL '24 hours',
              updated_at = NOW()
        WHERE id = $1`,
      [unitId]
    );

    // Application: post-intent + post-claim draft. Intent fields match a
    // 2-person household at 60% AMI for the Las Vegas MSA ($45,600/yr).
    const existingApp = await query(
      `SELECT a.id FROM applications a
         JOIN user_applications ua ON ua.application_id = a.id
        WHERE ua.user_id = $1
        LIMIT 1`,
      [applicantId]
    );
    let applicationId: string;
    if (existingApp.rows.length > 0) {
      applicationId = existingApp.rows[0].id;
      await query(
        `UPDATE applications
            SET property_id = $2,
                claimed_unit_id = $3,
                claim_expires_at = NOW() + INTERVAL '24 hours',
                intent_bedrooms = 2,
                intent_budget_min = 1000,
                intent_budget_max = 1300,
                intent_move_in_date = (CURRENT_DATE + INTERVAL '60 days')::date,
                intent_household_size = 2,
                gross_annual_income = 45000,
                qualifying_ami_tier = '60',
                qualifying_household_size = 2,
                qualifying_ami_calculated_at = NOW(),
                requested_rent_amount = $4,
                household_size = 2,
                status = 'draft',
                updated_at = NOW()
          WHERE id = $1`,
        [applicationId, propertyId, unitId, rent]
      );
    } else {
      const appRes = await query(
        `INSERT INTO applications (
           property_id, first_name, last_name, email,
           household_size, status,
           intent_bedrooms, intent_budget_min, intent_budget_max,
           intent_move_in_date, intent_household_size,
           gross_annual_income, qualifying_ami_tier,
           qualifying_household_size, qualifying_ami_calculated_at,
           claimed_unit_id, claim_expires_at, requested_rent_amount
         )
         VALUES (
           $1, 'Alex', 'Applicant', $2,
           2, 'draft',
           2, 1000, 1300,
           (CURRENT_DATE + INTERVAL '60 days')::date, 2,
           45000, '60',
           2, NOW(),
           $3, NOW() + INTERVAL '24 hours', $4
         )
         RETURNING id`,
        [propertyId, applicantEmail, unitId, rent]
      );
      applicationId = appRes.rows[0].id;
    }

    await query(
      `INSERT INTO user_applications (user_id, application_id, relationship)
       VALUES ($1, $2, 'primary')
       ON CONFLICT (user_id, application_id) DO NOTHING`,
      [applicantId, applicationId]
    );
    console.log(`  Seeded applicant: ${applicantEmail} (post-claim on B-201 @ David J. Hoggard)`);

    // Seed known problem addresses
    const problemAddresses = [
      { address: "999 Fraud Lane", city: "Las Vegas", state: "NV", zip: "89101", reason: "Multiple fraudulent applications originating from this address" },
      { address: "123 Scam St", city: "Henderson", state: "NV", zip: "89002", reason: "Known address used in identity theft ring" },
    ];

    for (const addr of problemAddresses) {
      await query(
        `INSERT INTO known_problem_addresses (address_line1, city, state, zip, reason)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (address_line1, city, state, zip) DO NOTHING`,
        [addr.address, addr.city, addr.state, addr.zip, addr.reason]
      );
    }
    console.log("  Known problem addresses seeded");

    // ── Waitlist entries (wedge #5) ───────────────────────────────────
    // Seed a realistic queue for the two senior properties that have
    // waitingListEnabled=true and the demo-favorite Donna Louise 2 family
    // property. Uses the existing 5 staff users as stand-in applicants
    // (the seed doesn't create dedicated applicant users), each enrolled in
    // a few (property, bedroom_count) lanes so a freshly-seeded dev DB
    // shows "#3 of 5" rather than "#1 of 1". One synthetic notification
    // snapshot per (property, bedroom) drives the "moved up N spots"
    // chip on the position screen.
    const waitlistProps = [
      "Louise Shell Senior Apartments",
      "Frank Hawkins Senior Apartments",
      "Cambridge Apartments",
    ];
    const userIdsRes = await query(
      `SELECT id FROM users WHERE email = ANY($1) ORDER BY email ASC`,
      [users.map((u) => u.email)]
    );
    const userIds: string[] = userIdsRes.rows.map((r: { id: string }) => r.id);

    let waitlistInserted = 0;
    for (const propName of waitlistProps) {
      const propRow = await query("SELECT id FROM properties WHERE name = $1", [propName]);
      if (propRow.rows.length === 0) continue;
      const propertyId = propRow.rows[0].id;

      for (const bedrooms of [1, 2]) {
        // Insert each user with a staggered created_at so positions are
        // stable and visibly different across the queue. -i hours so the
        // earliest user is "first in line".
        for (let i = 0; i < userIds.length; i++) {
          const userId = userIds[i];
          const hoursAgo = (userIds.length - i) * 24;
          const ins = await query(
            `INSERT INTO waitlist_entries
               (property_id, bedroom_count, applicant_user_id, created_at,
                notified_position_at, last_notified_position)
             VALUES ($1, $2, $3, NOW() - ($4 || ' hours')::interval, NOW() - INTERVAL '30 days', $5)
             ON CONFLICT (property_id, bedroom_count, applicant_user_id) DO NOTHING
             RETURNING id`,
            [propertyId, bedrooms, userId, String(hoursAgo), i + 3]
          );
          if (ins.rows.length > 0) waitlistInserted++;
        }
      }
    }
    console.log(`  Waitlist entries: ${waitlistInserted} seeded across ${waitlistProps.length} properties`);

    console.log(`\nSeed complete! ${properties.length} properties seeded.`);
    console.log("\nTest credentials (all passwords: password123):");
    for (const user of users) {
      console.log(`  ${user.role.padEnd(20)} → ${user.email}`);
    }
  } catch (err) {
    console.error("Seed failed:", (err as Error).message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seed();
