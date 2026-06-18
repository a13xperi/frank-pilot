/*
 * Operator CLI — ingest a OneSite wait-list export for a property.
 *
 *   npx tsx src/modules/waitlist-ingest/cli.ts --property <uuid> --file export.csv [--source onesite]
 *
 * Safe to run repeatedly: idempotent per (property, phone). Prints a summary
 * (parsed / imported / duplicates / invalid) and the batch id.
 */
import { readFileSync } from 'fs';
import { ingestOneSiteCsv } from './service';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const property = arg('property');
  const file = arg('file');
  const source = arg('source') || 'onesite';
  if (!property || !file) {
    console.error('Usage: --property <uuid> --file <path.csv> [--source onesite]');
    process.exit(1);
  }

  const csvText = readFileSync(file, 'utf8');
  const res = await ingestOneSiteCsv({ propertyId: property, csvText, fileName: file, source });

  console.log(`\nWait-list ingest — property ${property}`);
  console.log(`  parsed:     ${res.parsed}`);
  console.log(`  imported:   ${res.imported}`);
  console.log(`  duplicates: ${res.duplicates}`);
  console.log(`  invalid:    ${res.invalid}`);
  if (res.errors.length) {
    console.log('  errors:');
    res.errors.slice(0, 20).forEach((e) => console.log(`    row ${e.row}: ${e.reason}`));
    if (res.errors.length > 20) console.log(`    …and ${res.errors.length - 20} more`);
  }
  console.log(`  batch:      ${res.batchId}\n`);
  process.exit(0);
}

main().catch((e) => {
  console.error('Ingest failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
