/**
 * Demo Ledger Enrichment Seed (demo track, Jun 11)
 * The base demo seed creates 2 onboarded tenants / 11 ledger entries — far too
 * thin for the "system of record" pitch. This adds ~24 onboarded tenants across
 * the portfolio with 6 months of ledger history each (current payers, slow
 * payers, a delinquency ladder) so the Ledger + portfolio views read as a
 * living book. Idempotent: guarded by applicant email; safe to re-run.
 */

import dotenv from "dotenv";
dotenv.config();

import { pool, query } from "../config/database";
import { encrypt, hashSSN } from "../utils/encryption";

const TENANTS = [
  // [first, last, rent, profile] — profile: current | slow | delinquent1 | delinquent2
  ["Maria", "Santos", 925, "current"], ["DeShawn", "Carter", 1050, "current"],
  ["Linh", "Nguyen", 875, "current"], ["Robert", "Begay", 990, "current"],
  ["Angela", "Brooks", 1150, "current"], ["Hector", "Alvarez", 860, "current"],
  ["Tanya", "Whitehorse", 1020, "current"], ["Samuel", "Adeyemi", 1100, "current"],
  ["Grace", "Kim", 945, "current"], ["Dmitri", "Volkov", 1200, "current"],
  ["Patrice", "Johnson", 880, "current"], ["Miguel", "Torres", 1075, "current"],
  ["Yolanda", "Hayes", 950, "current"], ["Ahmed", "Hassan", 1010, "current"],
  ["Cassandra", "Lee", 1125, "current"], ["Jerome", "Walker", 905, "current"],
  ["Sofia", "Reyes", 985, "current"],
  ["Brandon", "Mills", 1060, "slow"], ["Renee", "Duncan", 930, "slow"],
  ["Tyler", "Osei", 1140, "slow"], ["Carmen", "Ibarra", 990, "slow"],
  ["Walter", "Knox", 1015, "delinquent1"], ["Felicia", "Grant", 940, "delinquent1"],
  ["Marcus", "Bell", 1185, "delinquent2"],
] as const;

const MONTHS_OF_HISTORY = 6;
const LATE_FEE = 50;

async function getUserId(email: string): Promise<string> {
  const r = await query("SELECT id FROM users WHERE email = $1", [email]);
  if (!r.rows.length) throw new Error(`seed user missing: ${email} — run npm run seed first`);
  return r.rows[0].id;
}

function period(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export async function seedDemoLedger(): Promise<void> {
  const agentId = await getUserId("agent@cdpc.test");
  const seniorId = await getUserId("senior@cdpc.test");
  const regionalId = await getUserId("regional@cdpc.test");
  const assetId = await getUserId("asset@cdpc.test");

  const props = await query("SELECT id, name FROM properties ORDER BY name");
  if (!props.rows.length) throw new Error("no properties — run npm run seed first");

  let tenantsCreated = 0;
  let entriesCreated = 0;
  let skipped = 0;

  for (let i = 0; i < TENANTS.length; i++) {
    const [first, last, rent, profile] = TENANTS[i];
    const email = `${first.toLowerCase()}.${last.toLowerCase()}@example.com`;

    // Idempotency guard — same convention as the property seed name-guard.
    const existing = await query("SELECT id FROM applications WHERE email = $1", [email]);
    if (existing.rows.length) { skipped++; continue; }

    const prop = props.rows[i % props.rows.length];
    const unit = `${"ABCD"[i % 4]}-${200 + i}`;
    const rawSsn = `22233${String(4000 + i)}`;
    const leaseStart = new Date();
    leaseStart.setMonth(leaseStart.getMonth() - (MONTHS_OF_HISTORY + 1 + (i % 6)));
    const leaseEnd = new Date(leaseStart);
    leaseEnd.setMonth(leaseEnd.getMonth() + 12);
    const now = Date.now();

    const ins = await query(
      `INSERT INTO applications
         (property_id, unit_number, first_name, last_name, ssn_encrypted, ssn_hash,
          date_of_birth_encrypted, email, phone, current_address_line1, current_city,
          current_state, current_zip, employer_name, annual_income, household_size,
          requested_lease_term_months, requested_rent_amount, status, submitted_by,
          submitted_at, background_check_result, credit_check_result,
          compliance_check_result, overall_screening_result,
          tier1_reviewer_id, tier1_decision, tier1_notes, tier1_decided_at,
          tier3_required, tier3_reviewer_id, tier3_decision, tier3_notes, tier3_decided_at,
          income_verified, income_verified_by, income_verified_at,
          onesite_lease_id, loft_tenant_id, auto_pay_enrolled,
          lease_start_date, lease_end_date, security_deposit_amount)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
               'onboarded',$19,$20,'pass','pass','pass','pass',
               $21,'pass','Application meets all criteria. Approved.',$22,
               true,$23,'pass','Final sign-off. All documentation complete.',$24,
               true,$25,$26,$27,$28,$29,$30,$31,$32)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        prop.id, unit, first, last, encrypt(rawSsn), hashSSN(rawSsn), encrypt("1985-06-15"),
        email, `702-555-${String(4100 + i).padStart(4, "0")}`,
        `${400 + i} Portfolio Ave`, "Las Vegas", "NV", "89103",
        "Demo Employer LLC", Math.round(rent * 34), 1 + (i % 4), 12, rent,
        agentId,
        new Date(leaseStart.getTime() - 14 * 86400000).toISOString(),
        seniorId, new Date(leaseStart.getTime() - 10 * 86400000).toISOString(),
        assetId, new Date(leaseStart.getTime() - 7 * 86400000).toISOString(),
        seniorId, new Date(leaseStart.getTime() - 8 * 86400000).toISOString(),
        `ols_enrich_${now}_${i}`, `lft_enrich_${now}_${i}`, profile === "current",
        leaseStart.toISOString().split("T")[0], leaseEnd.toISOString().split("T")[0], rent,
      ]
    );
    if (!ins.rows.length) { skipped++; continue; }
    const appId = ins.rows[0].id;
    tenantsCreated++;

    // The delinquency dashboard dates "overdue" from the tenant's FIRST rent
    // charge (no FIFO allocation), so delinquents get a short 3-month history
    // — same shape as Tomasz — to keep daysOverdue visually plausible.
    const history = profile.startsWith("delinquent") ? 3 : MONTHS_OF_HISTORY;
    let balance = 0;
    // delinquent1 misses the last month; delinquent2 misses the last two.
    const missFrom =
      profile === "delinquent1" ? history - 1 :
      profile === "delinquent2" ? history - 2 : history;

    for (let m = 0; m < history; m++) {
      const d = new Date();
      d.setMonth(d.getMonth() - (history - 1 - m));
      const per = period(d);
      const chargeDate = new Date(d.getFullYear(), d.getMonth(), 1);

      balance += rent;
      await query(
        `INSERT INTO tenant_ledger
           (application_id, property_id, entry_type, description, amount, balance_after,
            billing_period, due_date, created_at)
         VALUES ($1,$2,'rent_charge',$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
        [appId, prop.id, `Monthly rent — ${per}`, rent, balance, per, `${per}-01`, chargeDate.toISOString()]
      );
      entriesCreated++;

      // Slow payers pay late (day 9) with a late fee every third month.
      const paysLateThisMonth = profile === "slow" && m % 3 === 1;
      if (paysLateThisMonth) {
        balance += LATE_FEE;
        await query(
          `INSERT INTO tenant_ledger
             (application_id, property_id, entry_type, description, amount, balance_after,
              billing_period, created_at)
           VALUES ($1,$2,'late_fee',$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
          [appId, prop.id, `Late fee — ${per} (6 days late)`, LATE_FEE, balance, per,
           new Date(d.getFullYear(), d.getMonth(), 7).toISOString()]
        );
        entriesCreated++;
      }

      if (m < missFrom) {
        const payAmount = rent + (paysLateThisMonth ? LATE_FEE : 0);
        balance -= payAmount;
        await query(
          `INSERT INTO tenant_ledger
             (application_id, property_id, entry_type, description, amount, balance_after,
              billing_period, reference_id, created_at)
           VALUES ($1,$2,'payment',$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
          [appId, prop.id, "Payment received", -payAmount, balance, per, `enrich_pay_${per}_${i}`,
           new Date(d.getFullYear(), d.getMonth(), paysLateThisMonth ? 9 : 2 + (i % 4)).toISOString()]
        );
        entriesCreated++;
      } else {
        // Missed month → late fee lands, balance grows.
        balance += LATE_FEE;
        await query(
          `INSERT INTO tenant_ledger
             (application_id, property_id, entry_type, description, amount, balance_after,
              billing_period, created_at)
           VALUES ($1,$2,'late_fee',$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
          [appId, prop.id, `Late fee — ${per} (6 days late)`, LATE_FEE, balance, per,
           new Date(d.getFullYear(), d.getMonth(), 7).toISOString()]
        );
        entriesCreated++;
      }
    }
    console.log(`  ${profile.padEnd(11)} → ${first} ${last} @ ${prop.name} ${unit}: balance $${balance}`);
  }

  console.log(
    `\nLedger enrichment complete! ${tenantsCreated} tenants created (${skipped} already present), ` +
    `${entriesCreated} ledger entries added.`
  );
}

if (require.main === module) {
  seedDemoLedger()
    .then(() => pool.end())
    .catch((err) => {
      console.error("Ledger enrichment failed:", err.message);
      pool.end();
      process.exit(1);
    });
}
