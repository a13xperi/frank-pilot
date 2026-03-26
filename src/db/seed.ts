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

    // Create test properties
    const properties = [
      {
        name: "Desert Oasis Apartments",
        address: "1234 Las Vegas Blvd S",
        city: "Las Vegas",
        state: "NV",
        zip: "89109",
        unitCount: 120,
        amiArea: "Las Vegas-Henderson-Paradise, NV MSA",
      },
      {
        name: "Sunrise Gardens",
        address: "5678 E Sahara Ave",
        city: "Las Vegas",
        state: "NV",
        zip: "89142",
        unitCount: 80,
        amiArea: "Las Vegas-Henderson-Paradise, NV MSA",
      },
    ];

    for (const prop of properties) {
      await query(
        `INSERT INTO properties (name, address_line1, city, state, zip, unit_count, ami_area)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT DO NOTHING`,
        [prop.name, prop.address, prop.city, prop.state, prop.zip, prop.unitCount, prop.amiArea]
      );
      console.log(`  Property: ${prop.name} (${prop.unitCount} units)`);
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
          ["Las Vegas-Henderson-Paradise, NV MSA", year, size, ami30, ami50, ami60, ami80]
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
         VALUES ($1, $2, $3, $4, $5)`,
        [addr.address, addr.city, addr.state, addr.zip, addr.reason]
      );
    }
    console.log("  Known problem addresses seeded");

    console.log("\nSeed complete!");
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
