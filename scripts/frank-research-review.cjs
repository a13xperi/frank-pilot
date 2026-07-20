// Frank research-loop review surface (Phase 3, operator front door).
// The worker writes grounded answers as research_status='ready_for_review'; this
// is how a human sees them and approves so the dialer may deliver.
//
//   railway run -s Postgres node scripts/frank-research-review.cjs            # list pending
//   railway run -s Postgres node scripts/frank-research-review.cjs approve <id> ["edited answer"]
//
// Connects via DATABASE_PUBLIC_URL (off-network) or DATABASE_URL (in Railway).
// Read-only by default; `approve` flips one row to 'approved'. Never sends/dials.
const { Client } = require("pg");

async function main() {
  const [, , cmd, id, edited] = process.argv;
  const c = new Client({
    connectionString: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();
  try {
    if (cmd === "approve") {
      if (!id) { console.error("usage: ... approve <id> [\"edited answer\"]"); process.exit(1); }
      const sql = edited
        ? `UPDATE follow_ups SET answer=$2, research_status='approved', updated_at=NOW()
             WHERE id=$1 AND research_status='ready_for_review' RETURNING id, phone_e164, answer`
        : `UPDATE follow_ups SET research_status='approved', updated_at=NOW()
             WHERE id=$1 AND research_status='ready_for_review' RETURNING id, phone_e164, answer`;
      const r = await c.query(sql, edited ? [id, edited] : [id]);
      if (!r.rowCount) { console.log("No ready_for_review row with that id (already approved?)."); return; }
      console.log("✓ APPROVED — the dialer will deliver this on its next due tick:");
      console.table(r.rows);
      return;
    }
    // default: list the review queue
    const r = await c.query(
      `SELECT id, phone_e164, question, answer, answer_source, created_at
         FROM follow_ups WHERE research_status='ready_for_review' ORDER BY created_at ASC`
    );
    console.log(`=== ${r.rows.length} answer(s) awaiting review ===`);
    for (const x of r.rows) {
      console.log(`\n• id: ${x.id}   to: ${x.phone_e164}`);
      console.log(`  Q: ${x.question || "(from checkpoint)"}`);
      console.log(`  A: ${x.answer}`);
      console.log(`  source: ${x.answer_source}`);
      console.log(`  approve: railway run -s Postgres node scripts/frank-research-review.cjs approve ${x.id}`);
    }
    if (!r.rows.length) console.log("  (nothing to review)");
  } finally {
    await c.end();
  }
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
