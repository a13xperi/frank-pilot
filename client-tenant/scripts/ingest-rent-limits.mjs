// @ts-check
/**
 * Ingest Novogradac Rent & Income Limit exports into a typed reference module.
 *
 * Reads every per-county JSON in src/lib/data/rent-limits/*.json (each a
 * verbatim capture of one Novogradac calculator export — see clark-2026.json)
 * and emits src/lib/limits-2026.generated.ts, the single source of truth the
 * funnel reads for "what you'd qualify for / what you'd pay".
 *
 * Dependency-free (Node ESM, like the other scripts/*.mjs). To add a county,
 * drop another <county>-YYYY.json next to clark-2026.json and re-run:
 *     npm run ingest:limits
 *
 * Source: https://rent-income.novoco.com/free/calculator
 * Novogradac does not guarantee the accuracy of these limits.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, '..', 'src', 'lib', 'data', 'rent-limits');
const OUT_FILE = join(HERE, '..', 'src', 'lib', 'limits-2026.generated.ts');

const BEDROOM_KEYS = ['eff', 'br1', 'br2', 'br3', 'br4', 'br5'];

/** household-size map (string keys in JSON) -> object literal with numeric keys */
function hhMapLiteral(map) {
  const entries = Object.keys(map)
    .map(Number)
    .sort((a, b) => a - b)
    .map((k) => `${k}: ${map[k]}`);
  return `{ ${entries.join(', ')} }`;
}

function bedroomLiteral(map) {
  const entries = BEDROOM_KEYS.filter((k) => map[k] != null).map(
    (k) => `${k}: ${map[k]}`,
  );
  return `{ ${entries.join(', ')} }`;
}

function countyLiteral(raw) {
  const s = raw.hudPublished.section8VeryLow;
  return `  ${raw.countyKey}: {
    countyKey: '${raw.countyKey}',
    county: ${JSON.stringify(raw.county)},
    msa: ${JSON.stringify(raw.msa)},
    year: ${raw.year},
    program: ${JSON.stringify(raw.program)},
    personsPerBedroom: ${raw.personsPerBedroom},
    fourPersonAmi: ${raw.fourPersonAmi},
    source: ${JSON.stringify(raw.source)},
    retrieved: ${JSON.stringify(raw.retrieved)},
    // 50% MTSP income base by household size; every AMI tier derives from this.
    mtsp50ByHousehold: ${hhMapLiteral(raw.hudPublished.mtsp50)},
    section8: {
      extremelyLow: ${hhMapLiteral(raw.hudPublished.section8ExtremelyLow)},
      veryLow: ${hhMapLiteral(s)},
      low: ${hhMapLiteral(raw.hudPublished.section8Low)},
    },
    // Official 60% max rent by bedroom (verbatim); other tiers scale by tier/60.
    rent60ByBedroom: ${bedroomLiteral(raw.rentLimits['60'])},
    fmrByBedroom: ${bedroomLiteral(raw.rentLimits.fmr)},
  },`;
}

const files = readdirSync(DATA_DIR)
  .filter((f) => f.endsWith('.json'))
  .sort();

if (files.length === 0) {
  console.error(`No *.json found in ${DATA_DIR}`);
  process.exit(1);
}

const counties = files.map((f) =>
  JSON.parse(readFileSync(join(DATA_DIR, f), 'utf8')),
);

const literals = counties.map(countyLiteral).join('\n');
const keys = counties.map((c) => `'${c.countyKey}'`).join(', ');

const out = `/**
 * GENERATED FILE — do not edit by hand.
 * Regenerate with: npm run ingest:limits
 * Source: https://rent-income.novoco.com/free/calculator (Novogradac Rent &
 * Income Limit Calculator). Novogradac does not guarantee accuracy of these
 * limits. Raw per-county captures live in src/lib/data/rent-limits/.
 *
 * Counties: ${counties.map((c) => c.county).join(', ')}.
 */

export type AmiTier = '30' | '50' | '60' | '80';
export type BedroomKey = 'eff' | 'br1' | 'br2' | 'br3' | 'br4' | 'br5';

export interface CountyLimits {
  countyKey: string;
  county: string;
  msa: string;
  year: number;
  program: string;
  personsPerBedroom: number;
  fourPersonAmi: number;
  source: string;
  retrieved: string;
  /** 50% MTSP income base by household size (1..12). All AMI tiers derive from this. */
  mtsp50ByHousehold: Record<number, number>;
  section8: {
    extremelyLow: Record<number, number>;
    veryLow: Record<number, number>;
    low: Record<number, number>;
  };
  /** Official 60% max monthly rent by bedroom (verbatim from export). */
  rent60ByBedroom: Partial<Record<BedroomKey, number>>;
  /** Fair Market Rent by bedroom (for context vs. the affordable cap). */
  fmrByBedroom: Partial<Record<BedroomKey, number>>;
}

export type CountyKey = ${counties.map((c) => `'${c.countyKey}'`).join(' | ')};

export const LIMITS_2026: Record<CountyKey, CountyLimits> = {
${literals}
};

export const COUNTY_KEYS: readonly CountyKey[] = [${keys}];
`;

writeFileSync(OUT_FILE, out);
console.log(
  `Wrote ${OUT_FILE} — ${counties.length} county/counties: ${counties
    .map((c) => c.countyKey)
    .join(', ')}`,
);
