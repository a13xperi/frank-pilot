import dotenv from "dotenv";
dotenv.config();

import { pool, query } from "../config/database";
import { SCHEMA_SQL, DROP_SCHEMA_SQL } from "./schema";
import { logger } from "../utils/logger";

async function migrate() {
  const command = process.argv[2];

  try {
    if (command === "down" || command === "reset") {
      console.log("Dropping all tables...");
      await query(DROP_SCHEMA_SQL);
      console.log("Tables dropped.");
    }

    if (command !== "down") {
      console.log("Running migrations...");
      await query(SCHEMA_SQL);
      console.log("Migrations complete.");
    }
  } catch (err) {
    console.error("Migration failed:", (err as Error).message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
