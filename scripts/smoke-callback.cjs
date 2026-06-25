// Instant callback smoke test: insert ONE pending follow_up, scheduled now, with
// a realistic resume checkpoint + consent, so the dialer rings SMOKE_PHONE back
// and Frank should open resuming at the checkpoint (not a cold restart).
//   SMOKE_PHONE=+1702XXXXXXX railway run -s Postgres ... node scripts/smoke-callback.cjs
const { Client } = require("pg");

const phone = process.env.SMOKE_PHONE;
const CHECKPOINT =
  "Mid-DL2 application. Gathered: caller's name and that they want a 2-bedroom at Donna Louise. " +
  "NEXT STEP: collect income documents to finish pre-qualification. Resume exactly here — do not start over.";

(async () => {
  if (!phone || !/^\+\d{10,15}$/.test(phone)) {
    console.error(`Bad/empty SMOKE_PHONE=${JSON.stringify(phone)} — need E.164 like +17025551234`);
    process.exit(1);
  }
  const c = new Client({ connectionString: process.env.DATABASE_PUBLIC_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    const r = await c.query(
      `INSERT INTO follow_ups (phone_e164, reason, scheduled_for, consent_outbound, notes, checkpoint, source)
       VALUES ($1, 'callback_requested', now(), true, $2, $3, 'smoke_test')
       RETURNING id, phone_e164, reason, status, scheduled_for`,
      [phone, "SMOKE TEST — instant callback to prove dialer + context resume", CHECKPOINT]
    );
    console.log("Inserted smoke callback row:");
    console.table(r.rows);
    console.log("checkpoint:", CHECKPOINT);
    console.log("\nDialer should claim this on its next 5-min tick and ring", phone);
  } finally { await c.end(); }
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
