/**
 * Backfill properties.amenities / pet_policy / accessibility from the GPM web
 * extract (docs/intel/gpmglv-properties-extracted.json). Match is by NORMALIZED
 * name (lowercased, punctuation/whitespace collapsed) — there's no shared slug,
 * so we report matched + UNMATCHED explicitly (no silent misses).
 *
 *   npx ts-node src/db/seed-amenities.ts        (dry run — reports matches)
 *   npx ts-node src/db/seed-amenities.ts --apply (writes)
 */
import { readFileSync } from "fs";
import { join } from "path";
import { query } from "../config/database";
import { logger } from "../utils/logger";

interface ExtractedProperty {
  name: string;
  amenities?: string[];
  pet_policy?: string | null;
  accessibility?: string[] | string | null;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const path = join(__dirname, "../../docs/intel/gpmglv-properties-extracted.json");
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const extracted: ExtractedProperty[] = Array.isArray(raw) ? raw : raw.properties ?? raw.data ?? [];
  const byName = new Map(extracted.map((p) => [norm(p.name), p]));

  const dbRows = (await query(`SELECT id, name FROM properties`, [])).rows as Array<{ id: string; name: string }>;
  let matched = 0;
  const unmatched: string[] = [];

  for (const row of dbRows) {
    const ext = byName.get(norm(row.name));
    if (!ext) {
      unmatched.push(row.name);
      continue;
    }
    matched++;
    const amenities = Array.isArray(ext.amenities) ? ext.amenities : [];
    const accessibility = Array.isArray(ext.accessibility)
      ? ext.accessibility
      : ext.accessibility
        ? [ext.accessibility]
        : [];
    const petPolicy = ext.pet_policy ?? null;
    console.log(`  ✓ ${row.name} — ${amenities.length} amenities${petPolicy ? ", pet policy" : ""}`);
    if (apply) {
      await query(
        `UPDATE properties SET amenities = $2::jsonb, pet_policy = $3, accessibility = $4::jsonb WHERE id = $1`,
        [row.id, JSON.stringify(amenities), petPolicy, JSON.stringify(accessibility)]
      );
    }
  }

  console.log(`\n${apply ? "APPLIED" : "DRY RUN"} — matched ${matched}/${dbRows.length} properties.`);
  if (unmatched.length) console.log(`  UNMATCHED (no amenity data): ${unmatched.join("; ")}`);
  logger.info("seed-amenities done", { apply, matched, unmatched: unmatched.length });
  process.exit(0);
}

main().catch((e) => {
  console.error("seed-amenities failed:", e);
  process.exit(1);
});
