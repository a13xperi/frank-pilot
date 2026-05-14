import dotenv from "dotenv";
dotenv.config();

import { pool, query } from "../config/database";
import bcrypt from "bcrypt";

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

    // ── All 16 GPMGLV Properties ────────────────────────────────────
    const AMI = "Las Vegas-Henderson-Paradise, NV MSA";
    const properties = [
      // Senior properties (5)
      {
        name: "Louise Shell Senior Apartments", addressLine1: "2875 E Sahara Ave", city: "Las Vegas", zip: "89104",
        unitCount: 120, phone: "702-555-0101", email: "louiseshell@gpmglv.org", propertyManager: "Patricia Morales",
        propertyType: "senior", jurisdiction: "Las Vegas", totalVacancy: 3, waitingListEnabled: true,
        unitMix: { "1BR": 80, "2BR": 40 },
        rentSchedule: { "1BR_60AMI": 995, "2BR_60AMI": 1194 },
      },
      {
        name: "Frank Hawkins Senior Apartments", addressLine1: "3100 W Washington Ave", city: "Las Vegas", zip: "89107",
        unitCount: 100, phone: "702-555-0102", email: "frankhawkins@gpmglv.org", propertyManager: "Latonya Williams",
        propertyType: "senior", jurisdiction: "Las Vegas", totalVacancy: 0, waitingListEnabled: true,
        unitMix: { "1BR": 60, "2BR": 40 },
        rentSchedule: { "1BR_60AMI": 995, "2BR_60AMI": 1194 },
      },
      {
        name: "Heritage Park Senior", addressLine1: "1500 N Martin Luther King Blvd", city: "Las Vegas", zip: "89106",
        unitCount: 80, phone: "702-555-0103", email: "heritagepark@gpmglv.org", propertyManager: "David Tran",
        propertyType: "senior", jurisdiction: "Las Vegas", totalVacancy: 2, waitingListEnabled: false,
        unitMix: { "1BR": 50, "2BR": 30 },
        rentSchedule: { "1BR_60AMI": 995, "2BR_60AMI": 1194 },
      },
      {
        name: "Carey Avenue Senior Living", addressLine1: "4200 E Carey Ave", city: "Las Vegas", zip: "89115",
        unitCount: 60, phone: "702-555-0104", email: "careyave@gpmglv.org", propertyManager: "Maria Gonzalez",
        propertyType: "senior", jurisdiction: "Las Vegas", totalVacancy: 1, waitingListEnabled: true,
        unitMix: { "1BR": 40, "2BR": 20 },
        rentSchedule: { "1BR_60AMI": 995, "2BR_60AMI": 1194 },
      },
      {
        name: "Desert Pines Senior", addressLine1: "3601 E Bonanza Rd", city: "Las Vegas", zip: "89110",
        unitCount: 48, phone: "702-555-0105", email: "desertpines@gpmglv.org", propertyManager: "James Patterson",
        propertyType: "senior", jurisdiction: "Las Vegas", totalVacancy: 0, waitingListEnabled: true,
        unitMix: { "1BR": 32, "2BR": 16 },
        rentSchedule: { "1BR_60AMI": 995, "2BR_60AMI": 1194 },
      },
      // Family properties (10)
      {
        name: "Cambridge Apartments", addressLine1: "4500 Cambridge St", city: "Las Vegas", zip: "89119",
        unitCount: 200, phone: "702-555-0106", email: "cambridge@gpmglv.org", propertyManager: "Robert Jackson",
        propertyType: "family", jurisdiction: "Las Vegas", totalVacancy: 8, waitingListEnabled: false,
        unitMix: { "1BR": 40, "2BR": 80, "3BR": 60, "4BR": 20 },
        rentSchedule: { "1BR_60AMI": 995, "2BR_60AMI": 1194, "3BR_60AMI": 1380, "4BR_60AMI": 1539 },
      },
      {
        name: "Desert Oasis Apartments", addressLine1: "1234 Las Vegas Blvd S", city: "Las Vegas", zip: "89109",
        unitCount: 120, phone: "702-555-0107", email: "desertoasis@gpmglv.org", propertyManager: "Angela Foster",
        propertyType: "family", jurisdiction: "Las Vegas", totalVacancy: 5, waitingListEnabled: false,
        unitMix: { "1BR": 30, "2BR": 50, "3BR": 40 },
        rentSchedule: { "1BR_60AMI": 995, "2BR_60AMI": 1194, "3BR_60AMI": 1380 },
      },
      {
        name: "Sunrise Gardens", addressLine1: "5678 E Sahara Ave", city: "Las Vegas", zip: "89142",
        unitCount: 80, phone: "702-555-0108", email: "sunrisegardens@gpmglv.org", propertyManager: "Kevin Wright",
        propertyType: "family", jurisdiction: "Las Vegas", totalVacancy: 2, waitingListEnabled: false,
        unitMix: { "2BR": 40, "3BR": 40 },
        rentSchedule: { "2BR_60AMI": 1194, "3BR_60AMI": 1380 },
      },
      {
        name: "Crestview Family Homes", addressLine1: "900 N Nellis Blvd", city: "Las Vegas", zip: "89110",
        unitCount: 150, phone: "702-555-0109", email: "crestview@gpmglv.org", propertyManager: "Sandra Mitchell",
        propertyType: "family", jurisdiction: "Las Vegas", totalVacancy: 6, waitingListEnabled: false,
        unitMix: { "2BR": 50, "3BR": 60, "4BR": 40 },
        rentSchedule: { "2BR_60AMI": 1194, "3BR_60AMI": 1380, "4BR_60AMI": 1539 },
      },
      {
        name: "Valley View Terrace", addressLine1: "2200 Valley View Blvd", city: "Henderson", zip: "89014",
        unitCount: 96, phone: "702-555-0110", email: "valleyview@gpmglv.org", propertyManager: "Charles Adams",
        propertyType: "family", jurisdiction: "Henderson", totalVacancy: 4, waitingListEnabled: false,
        unitMix: { "1BR": 24, "2BR": 48, "3BR": 24 },
        rentSchedule: { "1BR_60AMI": 995, "2BR_60AMI": 1194, "3BR_60AMI": 1380 },
      },
      {
        name: "Boulder Highway Family", addressLine1: "4800 Boulder Hwy", city: "Henderson", zip: "89121",
        unitCount: 110, phone: "702-555-0111", email: "boulderhwy@gpmglv.org", propertyManager: "Diana Ruiz",
        propertyType: "family", jurisdiction: "Henderson", totalVacancy: 3, waitingListEnabled: true,
        unitMix: { "2BR": 50, "3BR": 40, "4BR": 20 },
        rentSchedule: { "2BR_60AMI": 1194, "3BR_60AMI": 1380, "4BR_60AMI": 1539 },
      },
      {
        name: "Cheyenne Pointe", addressLine1: "3900 W Cheyenne Ave", city: "North Las Vegas", zip: "89032",
        unitCount: 180, phone: "702-555-0112", email: "cheyenne@gpmglv.org", propertyManager: "Brian Thompson",
        propertyType: "family", jurisdiction: "North Las Vegas", totalVacancy: 7, waitingListEnabled: false,
        unitMix: { "1BR": 30, "2BR": 60, "3BR": 60, "4BR": 30 },
        rentSchedule: { "1BR_60AMI": 995, "2BR_60AMI": 1194, "3BR_60AMI": 1380, "4BR_60AMI": 1539 },
      },
      {
        name: "Civic Center Family", addressLine1: "2100 Civic Center Dr", city: "North Las Vegas", zip: "89030",
        unitCount: 72, phone: "702-555-0113", email: "civiccenter@gpmglv.org", propertyManager: "Lisa Nguyen",
        propertyType: "family", jurisdiction: "North Las Vegas", totalVacancy: 1, waitingListEnabled: true,
        unitMix: { "2BR": 36, "3BR": 36 },
        rentSchedule: { "2BR_60AMI": 1194, "3BR_60AMI": 1380 },
      },
      {
        name: "Tropicana Gardens", addressLine1: "5500 E Tropicana Ave", city: "Las Vegas", zip: "89122",
        unitCount: 144, phone: "702-555-0114", email: "tropicana@gpmglv.org", propertyManager: "Mark Hernandez",
        propertyType: "family", jurisdiction: "Las Vegas", totalVacancy: 4, waitingListEnabled: false,
        unitMix: { "1BR": 24, "2BR": 60, "3BR": 48, "4BR": 12 },
        rentSchedule: { "1BR_60AMI": 995, "2BR_60AMI": 1194, "3BR_60AMI": 1380, "4BR_60AMI": 1539 },
      },
      {
        name: "Spring Mountain Place", addressLine1: "3200 Spring Mountain Rd", city: "Las Vegas", zip: "89102",
        unitCount: 88, phone: "702-555-0115", email: "springmtn@gpmglv.org", propertyManager: "Jennifer Clarke",
        propertyType: "family", jurisdiction: "Las Vegas", totalVacancy: 2, waitingListEnabled: false,
        unitMix: { "1BR": 20, "2BR": 44, "3BR": 24 },
        rentSchedule: { "1BR_60AMI": 995, "2BR_60AMI": 1194, "3BR_60AMI": 1380 },
      },
      // Mixed-use (1)
      {
        name: "Charleston Gateway", addressLine1: "1800 E Charleston Blvd", city: "Las Vegas", zip: "89104",
        unitCount: 160, phone: "702-555-0116", email: "charleston@gpmglv.org", propertyManager: "Anthony Brooks",
        propertyType: "mixed_use", jurisdiction: "Las Vegas", totalVacancy: 5, waitingListEnabled: false,
        unitMix: { "Studio": 20, "1BR": 40, "2BR": 60, "3BR": 40 },
        rentSchedule: { "Studio_60AMI": 747, "1BR_60AMI": 995, "2BR_60AMI": 1194, "3BR_60AMI": 1380 },
      },
    ];

    const INSERT_SQL = `INSERT INTO properties
      (name, address_line1, city, state, zip, unit_count, ami_area,
       phone, email, property_manager, property_type,
       lihtc_type, ami_set_aside, compliance_period_start, compliance_period_end,
       has_lura, has_mortgage, jurisdiction,
       unit_mix, rent_schedule, total_vacancy, waiting_list_enabled)
      VALUES ($1,$2,$3,'NV',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
      ON CONFLICT DO NOTHING`;

    for (const p of properties) {
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
