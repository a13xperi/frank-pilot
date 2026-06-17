/**
 * DM-FRANK-024 Accounts Payable — demo seed.
 *
 * Idempotent: vendors keyed by name, invoices by invoice_number. Attaches to
 * the first existing property and a system_admin (or any) user, and leaves
 * invoices at 'entered' so a demo can walk the full cut → review → sign →
 * disburse chain live (separation of duties needs distinct logged-in users).
 */

import { pool, query } from "../config/database";

async function getOne(sql: string, params: unknown[] = []): Promise<Record<string, any> | null> {
  const r = await query(sql, params);
  return (r.rows[0] as Record<string, any>) ?? null;
}

export async function seedDemoAp(): Promise<void> {
  const property = await getOne(`SELECT id FROM properties ORDER BY created_at ASC LIMIT 1`);
  if (!property) {
    console.log("AP demo seed skipped: no properties to attach to (seed properties first).");
    return;
  }
  const admin =
    (await getOne(`SELECT id FROM users WHERE role = 'system_admin' ORDER BY created_at ASC LIMIT 1`)) ??
    (await getOne(`SELECT id FROM users ORDER BY created_at ASC LIMIT 1`));
  if (!admin) {
    console.log("AP demo seed skipped: no users to attribute capture to.");
    return;
  }

  const vendors = [
    { name: "Sierra Plumbing & Mechanical", phone: "702-555-0142" },
    { name: "Desert Glow Electric", phone: "702-555-0188" },
  ];
  const vendorIds: Record<string, string> = {};
  for (const v of vendors) {
    let row = await getOne(`SELECT id FROM ap_vendors WHERE name = $1`, [v.name]);
    if (!row) {
      row = await getOne(
        `INSERT INTO ap_vendors (name, phone, created_by) VALUES ($1, $2, $3) RETURNING id`,
        [v.name, v.phone, admin.id],
      );
    }
    vendorIds[v.name] = row!.id;
  }

  const invoices = [
    { vendor: "Sierra Plumbing & Mechanical", amountCents: 184500, invoiceNumber: "SPM-2041", billingNumber: "B-7781", unitNumber: "12B", receivedVia: "email" },
    { vendor: "Desert Glow Electric", amountCents: 92000, invoiceNumber: "DGE-5567", billingNumber: "B-7782", unitNumber: "common", receivedVia: "postal" },
    { vendor: "Sierra Plumbing & Mechanical", amountCents: 47350, invoiceNumber: "SPM-2042", billingNumber: "B-7790", unitNumber: "04A", receivedVia: "manager_forward" },
  ];
  let created = 0;
  for (const inv of invoices) {
    const exists = await getOne(`SELECT id FROM ap_invoices WHERE invoice_number = $1`, [inv.invoiceNumber]);
    if (exists) continue;
    await query(
      `INSERT INTO ap_invoices
         (vendor_id, property_id, amount_cents, invoice_number, billing_number, unit_number, received_via, status, entered_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'entered', $8)`,
      [vendorIds[inv.vendor], property.id, inv.amountCents, inv.invoiceNumber, inv.billingNumber, inv.unitNumber, inv.receivedVia, admin.id],
    );
    created++;
  }

  console.log(
    `AP demo seed complete: ${Object.keys(vendorIds).length} vendors, ${created} new invoices (entered) on property ${property.id}.`,
  );
}

if (require.main === module) {
  seedDemoAp()
    .then(() => pool.end())
    .catch((err) => {
      console.error("AP demo seed failed:", (err as Error).message);
      pool.end();
      process.exit(1);
    });
}
