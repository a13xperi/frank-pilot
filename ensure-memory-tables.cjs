// Create the two voice-memory tables on boot via the pg client (idempotent,
// no psql, non-fatal). Sidesteps the full migrate (which needs psql for
// ALTER-TYPE deltas not present in the runtime image).
const { Client } = require("pg");
const fs = require("fs");
const path = require("path");
const FILES = [
  "src/db/migrations/2026-06-22-validation-pins.sql",
  "src/db/migrations/2026-06-22-caller-history.sql",
];
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await c.connect();
    for (const f of FILES) {
      await c.query(fs.readFileSync(path.join(process.cwd(), f), "utf8"));
      console.log("ensured", f);
    }
    console.log("memory tables ensured");
  } catch (e) {
    console.error("ensure-memory-tables (non-fatal):", e.message);
  } finally {
    try { await c.end(); } catch (_) {}
  }
})();
