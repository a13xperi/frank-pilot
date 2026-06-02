import dotenv from "dotenv";
dotenv.config();

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pool, query } from "../config/database";
import { SCHEMA_SQL, DROP_SCHEMA_SQL } from "./schema";

// ────────────────────────────────────────────────────────────────────────────
// migrate.ts — the SINGLE database-provisioning path (CI, local e2e, prod).
//
// Two layers, applied in order, every run:
//
//   1. SCHEMA_SQL (src/db/schema.ts) — the base schema. Now fully idempotent
//      (CREATE TABLE/INDEX IF NOT EXISTS; enums wrapped in
//      `DO $$ … EXCEPTION WHEN duplicate_object`), so it re-runs safely against
//      an existing database and self-heals any base object that's missing.
//      Run as ONE batch over the pg pool (atomic; no ALTER TYPE ADD VALUE here).
//
//   2. The incremental deltas under src/db/migrations/*.sql, applied in
//      filename order, each EXACTLY ONCE, tracked in the `schema_migrations`
//      table. Applied via `psql -f` (NOT the pg client) because several deltas
//      use `ALTER TYPE … ADD VALUE`, which Postgres forbids inside a
//      transaction block — node-pg's simple-query protocol wraps a
//      multi-statement string in one implicit transaction, psql does not.
//
// Before this runner the two layers diverged: `npm run migrate` ran only
// SCHEMA_SQL (so CI/fresh installs missed every migration-only object) while
// prod had deltas hand-applied (so anything forgotten silently went missing —
// e.g. the saved_properties/guest_sessions prod-500). Now all environments
// converge on base + tracked deltas.
//
// Commands:
//   (none) | up   run SCHEMA_SQL, then apply any pending tracked deltas
//   status        show applied vs pending deltas; make no changes
//   baseline      record all delta files as applied WITHOUT running them
//                 (escape hatch for adopting a DB already known to be current)
//   down          drop the entire schema (incl. schema_migrations) — DEV ONLY
//   reset         down, then up
// ────────────────────────────────────────────────────────────────────────────

const MIGRATIONS_DIR = join(__dirname, "migrations");

function listMigrationFiles(): string[] {
  if (!existsSync(MIGRATIONS_DIR)) return [];
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

async function ensureTrackingTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function appliedSet(): Promise<Set<string>> {
  const r = await query(`SELECT filename FROM schema_migrations`);
  return new Set(r.rows.map((row: { filename: string }) => row.filename));
}

/** Build the psql connection args from the SAME env the pg pool uses. */
function psqlConnArgs(): { args: string[]; env: NodeJS.ProcessEnv } {
  const env = { ...process.env };
  if (process.env.DATABASE_URL) {
    // psql accepts a conninfo URI as a positional arg.
    return { args: [process.env.DATABASE_URL], env };
  }
  if (process.env.DB_PASSWORD) env.PGPASSWORD = process.env.DB_PASSWORD;
  return {
    args: [
      "-h",
      process.env.DB_HOST || "localhost",
      "-p",
      process.env.DB_PORT || "5432",
      "-U",
      process.env.DB_USER || "postgres",
      "-d",
      process.env.DB_NAME || "frank_pilot",
    ],
    env,
  };
}

/** Apply one delta file via psql (-f, ON_ERROR_STOP). Throws on failure. */
function applyDeltaFile(file: string): void {
  const { args, env } = psqlConnArgs();
  const r = spawnSync(
    "psql",
    [...args, "-v", "ON_ERROR_STOP=1", "-q", "-f", join(MIGRATIONS_DIR, file)],
    { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", env }
  );
  if (r.error && (r.error as NodeJS.ErrnoException).code === "ENOENT") {
    throw new Error(
      "psql not found on PATH — it is required to apply migration deltas " +
        "(several use `ALTER TYPE … ADD VALUE`, which cannot run through the " +
        "pg client's implicit transaction). Install the postgresql-client package."
    );
  }
  if (r.status !== 0) {
    throw new Error(`migration ${file} failed:\n${(r.stderr ?? "").trim()}`);
  }
}

async function recordApplied(file: string): Promise<void> {
  await query(
    `INSERT INTO schema_migrations (filename) VALUES ($1)
     ON CONFLICT (filename) DO NOTHING`,
    [file]
  );
}

/** Run SCHEMA_SQL, then apply every not-yet-recorded delta in filename order. */
async function up(): Promise<void> {
  console.log("Applying base schema (SCHEMA_SQL)…");
  await query(SCHEMA_SQL);

  await ensureTrackingTable();
  const applied = await appliedSet();
  const all = listMigrationFiles();
  const pending = all.filter((f) => !applied.has(f));

  if (pending.length === 0) {
    console.log(
      `Schema synced. Deltas: ${all.length} total, ${applied.size} already applied, 0 pending.`
    );
    return;
  }

  console.log(`Applying ${pending.length} pending delta(s):`);
  for (const file of pending) {
    applyDeltaFile(file);
    await recordApplied(file);
    console.log(`  ✓ ${file}`);
  }
  console.log(
    `Schema synced. Deltas: ${all.length} total, ${applied.size} pre-existing, ${pending.length} newly applied.`
  );
}

async function status(): Promise<void> {
  await ensureTrackingTable();
  const applied = await appliedSet();
  const all = listMigrationFiles();
  const pending = all.filter((f) => !applied.has(f));
  console.log(`schema_migrations: ${applied.size} applied, ${pending.length} pending`);
  if (pending.length > 0) {
    console.log("Pending:");
    for (const f of pending) console.log(`  • ${f}`);
  }
}

/** Record every delta file as applied WITHOUT executing it. */
async function baseline(): Promise<void> {
  await ensureTrackingTable();
  const all = listMigrationFiles();
  for (const f of all) await recordApplied(f);
  console.log(`Baselined: marked ${all.length} delta(s) as applied (none executed).`);
}

async function down(): Promise<void> {
  console.log("Dropping all tables…");
  await query(DROP_SCHEMA_SQL);
  await query(`DROP TABLE IF EXISTS schema_migrations CASCADE`);
  console.log("Tables dropped.");
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "up";

  if (
    (command === "down" || command === "reset") &&
    process.env.NODE_ENV === "production"
  ) {
    console.error(`Refusing to run destructive \`${command}\` with NODE_ENV=production.`);
    process.exit(1);
  }

  try {
    switch (command) {
      case "up":
        await up();
        break;
      case "status":
        await status();
        break;
      case "baseline":
        await baseline();
        break;
      case "down":
        await down();
        break;
      case "reset":
        await down();
        await up();
        break;
      default:
        console.error(
          `Unknown command: ${command}. Use up | status | baseline | down | reset.`
        );
        process.exit(1);
    }
  } catch (err) {
    console.error("Migration failed:", (err as Error).message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
