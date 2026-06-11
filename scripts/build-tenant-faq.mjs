#!/usr/bin/env node
/**
 * build-tenant-faq.mjs
 *
 * Parses the GPMG LV "Tenant FAQ 500" document (checked in verbatim at
 * docs/intel/tenant-faq-source.txt, extracted from the original .docx with
 * `textutil -convert txt`) into the structured corpus the housing-qa agent
 * retrieves from:
 *
 *   src/db/data/tenant-faq.json
 *
 * Zero external deps. Pipeline: repair -> parse -> curate -> lint -> emit.
 *
 * REPAIR: the source docx suffered a botched find/replace — "MTSP" (HUD
 * Multifamily Tax Subsidy Projects) became "MTENANT SCREENING PROCESS" and
 * "TSP"/"Tenant Selection Plan" became "TENANT SCREENING PROCESS". Repairs are
 * ordered: the MTENANT form must be fixed before the bare uppercase form.
 *
 * CURATE: hand rewrites live in the OVERRIDES map below (never edit the JSON
 * by hand — it is a pure build artifact). Overrides strip values that violate
 * the agent's grounding rules: year-pinned figures, ballpark dollar amounts,
 * and anything contradicting the locked always-on platform facts (the
 * application fee is exactly the facts.applicationFee value — the source's
 * "$25–$50" range must never reach the model).
 *
 * LINT: the build FAILS if any forbidden pattern survives ($ figures, 202x
 * years, corruption residue), if ids collide, or if the source-number ranges
 * don't cover exactly 1..500 with no overlap.
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'docs', 'intel', 'tenant-faq-source.txt');
const OUT = path.join(ROOT, 'src', 'db', 'data', 'tenant-faq.json');

// ---------- repair pass (ordered — MTENANT must precede the bare form) ----------
const REPAIRS = [
  [/MTENANT SCREENING PROCESS/g, 'MTSP'],
  [/TENANT SCREENING PROCESS/g, 'Tenant Selection Plan'],
  [/Tenant Screening Process/g, 'Tenant Selection Plan'],
];

// ---------- curation overrides (applied after parsing, keyed by id) ----------
const OVERRIDES = {
  // Year-pinned HUD dates + ballpark "$50k–$60k" income figure removed.
  'tfaq-005': {
    answer:
      'This depends on the specific unit/set-aside at the property (commonly 50% or 60% of AMI). Limits are adjusted by household size and updated annually by HUD (MTSP limits for LIHTC). Contact the property for the exact limit for your household size and unit type — the application verifies this. Income includes most household members’ gross income (wages, SS, etc.). Properties use the most restrictive applicable limit if multiple programs layer.',
  },
  // "$25–$50" contradicts the locked always-on platform fact ($35.95/adult).
  'tfaq-011': {
    answer:
      'LIHTC properties charge a reasonable, non-refundable application fee to cover processing and screening costs (background/credit checks). On this platform the fee is a fixed amount per adult — see the platform fee fact for the exact figure. Some properties waive or reduce fees for certain applicants. It is not the same as a security deposit. Fees must comply with state and local rules; they cannot be excessive.',
  },
  // "~$50,000 threshold (currently)" drifts yearly.
  'tfaq-071': {
    answer:
      'To calculate total household assets and any income they generate (e.g., interest). This ensures compliance with income eligibility rules. Assets help determine if imputed income applies (over the HOTMA asset threshold, which is adjusted annually).',
  },
  // "As of 2026 HUD enforcement guidance" — year-pinned.
  'tfaq-126-128': {
    answer:
      'Assistance animals (trained service animals) are not pets. They are allowed as a reasonable accommodation even in no-pet properties (per Fair Housing Act). Note: under current HUD guidance, the focus is on trained service animals performing specific tasks; emotional support animals (ESAs) have narrower federal enforcement protection.',
  },
  // Source ends with a dangling "To download the app, go to: " (URL missing).
  'tfaq-226-232': {
    answer:
      'All applications must be submitted via the GPMGLV app on your phone or computer. This ensures accuracy and speed. You may ask someone for assistance if you need help.',
  },
  // Sentence garbled beyond regex repair ("per the app which is their preferred …").
  'tfaq-243-247': {
    answer:
      'The property will attempt contact per its Tenant Selection Plan. It is your responsibility to check the app frequently and respond promptly to avoid removal.',
  },
};

// ---------- forbidden patterns (build fails if any survive) ----------
const FORBIDDEN = [
  [/\$\s?\d/, 'dollar figure'],
  [/\b202\d\b/, 'year-pinned 202x date'],
  [/screening process/i, 'find/replace corruption residue'],
  [/MTENANT/, 'find/replace corruption residue (MTENANT)'],
];

const pad3 = (n) => String(n).padStart(3, '0');
const kebab = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

function main(raw) {
  // textutil preserves Word soft line breaks as U+2028 (and U+2029); JS `.`
  // matches neither and split('\n') doesn't split on them — normalize first.
  let text = raw.replace(/[\u2028\u2029]/g, '\n').replace(/\r\n?/g, '\n');
  for (const [re, replacement] of REPAIRS) text = text.replace(re, replacement);

  const lines = text.split('\n');
  const entryRe = /^\s*(\d{1,3})(?:[–-](\d{1,3}))?[.)]\s*(.*)$/;
  // Section headers are short unnumbered title lines with no terminal
  // punctuation; to disambiguate from answer continuation lines, a header must
  // also be immediately followed (skipping blanks) by a numbered entry line.
  const headerRe = /^[A-Z][A-Za-z ,/&'’-]{2,60}$/;

  const nextNonEmpty = (i) => {
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() !== '') return lines[j];
    }
    return '';
  };

  const entries = [];
  let current = null; // { from, to, firstLine, contLines, section, sectionTitle }
  let sectionTitle = 'Program Basics';
  let seenFirstEntry = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const em = entryRe.exec(line);

    if (em) {
      seenFirstEntry = true;
      if (current) entries.push(current);
      current = {
        from: parseInt(em[1], 10),
        to: em[2] ? parseInt(em[2], 10) : parseInt(em[1], 10),
        firstLine: em[3].trim(),
        contLines: [],
        sectionTitle,
      };
      continue;
    }

    if (!seenFirstEntry) continue; // preamble

    if (
      headerRe.test(trimmed) &&
      !/[.:;!?]$/.test(trimmed) &&
      entryRe.test(nextNonEmpty(i))
    ) {
      if (current) entries.push(current);
      current = null;
      sectionTitle = trimmed;
      continue;
    }

    if (current && trimmed !== '') {
      // Continuation line — normalize the docx tab-bullet form.
      current.contLines.push(trimmed.replace(/^•\s*/, '• '));
    }
  }
  if (current) entries.push(current);

  // ---------- Q/A split + assembly ----------
  const out = [];
  for (const e of entries) {
    const qEnd = e.firstLine.lastIndexOf('?');
    let question;
    let answerParts = [];
    if (qEnd === -1) {
      throw new Error(`entry #${e.from}: first line has no '?': ${e.firstLine}`);
    }
    question = e.firstLine.slice(0, qEnd + 1).trim();
    const rest = e.firstLine.slice(qEnd + 1).trim();
    if (rest) answerParts.push(rest);
    answerParts = answerParts.concat(e.contLines);
    let answer = answerParts.join('\n').trim();

    const id =
      e.from === e.to ? `tfaq-${pad3(e.from)}` : `tfaq-${pad3(e.from)}-${pad3(e.to)}`;
    const label = e.from === e.to ? `#${e.from}` : `#${e.from}–${e.to}`;

    const override = OVERRIDES[id];
    if (override) {
      if (override.drop) continue;
      if (override.answer) answer = override.answer;
    }

    // Expand the first MTSP per entry so the model can explain the acronym.
    answer = answer.replace(/\bMTSP\b/, 'MTSP (Multifamily Tax Subsidy Projects)');

    out.push({
      id,
      label,
      section: kebab(e.sectionTitle),
      sectionTitle: e.sectionTitle,
      sourceNumbers: { from: e.from, to: e.to },
      question,
      answer,
    });
  }

  // ---------- lint (fail the build on violations) ----------
  const problems = [];
  const ids = new Set();
  const covered = new Array(501).fill(false);
  for (const e of out) {
    if (ids.has(e.id)) problems.push(`duplicate id ${e.id}`);
    ids.add(e.id);
    for (let n = e.sourceNumbers.from; n <= e.sourceNumbers.to; n++) {
      if (n < 1 || n > 500) {
        problems.push(`${e.id}: source number ${n} out of 1..500`);
      } else if (covered[n]) {
        problems.push(`${e.id}: source number ${n} covered twice`);
      } else {
        covered[n] = true;
      }
    }
    if (!e.question.endsWith('?')) problems.push(`${e.id}: question does not end with '?'`);
    if (!e.answer) problems.push(`${e.id}: empty answer`);
    for (const [re, why] of FORBIDDEN) {
      if (re.test(e.question) || re.test(e.answer)) {
        problems.push(`${e.id}: forbidden pattern (${why})`);
      }
    }
  }
  for (let n = 1; n <= 500; n++) {
    if (!covered[n]) problems.push(`source number ${n} not covered by any entry`);
  }
  if (problems.length) {
    console.error(`LINT FAILED (${problems.length} problem(s)):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  // ---------- flag report (informational — eyeball before committing) ----------
  console.log(`parsed ${out.length} entries covering #1–500`);
  console.log(`sections: ${new Set(out.map((e) => e.section)).size}`);
  console.log('\nflag report:');
  for (const e of out) {
    if (OVERRIDES[e.id]) console.log(`  [override] ${e.id} — hand-curated answer`);
  }
  for (const e of out) {
    if (e.answer.length < 20) console.log(`  [short-answer] ${e.id} (${e.answer.length} ch): "${e.answer}"`);
  }
  for (const e of out) {
    if (e.question.length > 160) console.log(`  [long-question] ${e.id} (${e.question.length} ch)`);
  }

  return {
    source: 'docs/intel/tenant-faq-source.txt',
    generatedBy: 'scripts/build-tenant-faq.mjs',
    generatedAt: new Date().toISOString().slice(0, 10),
    entryCount: out.length,
    entries: out,
  };
}

const raw = await readFile(SOURCE, 'utf8');
const corpus = main(raw);
await writeFile(OUT, JSON.stringify(corpus, null, 2) + '\n', 'utf8');
console.log(`\nwrote ${OUT} (${corpus.entryCount} entries)`);
