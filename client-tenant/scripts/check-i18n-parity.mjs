#!/usr/bin/env node
/**
 * EN-ES i18n parity guard.
 *
 * Walks client-tenant/src/i18n/<locale>/ namespace files and verifies:
 *   - every key in en/ exists in es/ (and vice-versa: no orphan ES keys)
 *   - every namespace file in one locale exists in the other
 *   - no ES leaf value is empty / null / identical to the EN value
 *     (a heuristic for "untranslated, copied from EN")
 *
 * Pure stdlib. Run via:
 *   node client-tenant/scripts/check-i18n-parity.mjs
 *   npm run check:i18n   (from client-tenant/)
 *
 * Exit codes:
 *   0 — parity clean
 *   1 — parity violations (details printed to stdout, summary on stderr)
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const I18N_ROOT = resolve(__dirname, '..', 'src', 'i18n');
const BASE_LOCALE = 'en';
// Locales other than the base that must match. We only ship en/es today, but
// the script is structured so adding (e.g.) 'zh' later just works.
const TARGET_LOCALES = ['es'];

// ---------- helpers ----------

/** List immediate subdirectories of `dir` (non-recursive). */
function listLocales(dir) {
  return readdirSync(dir)
    .filter((name) => {
      try {
        return statSync(join(dir, name)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();
}

/** List *.json filenames (without extension) in a locale directory. */
function listNamespaces(localeDir) {
  return readdirSync(localeDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

function loadNs(localeDir, ns) {
  const path = join(localeDir, `${ns}.json`);
  const raw = readFileSync(path, 'utf8');
  return JSON.parse(raw);
}

/**
 * Walk an object tree and yield { path, value } for every leaf.
 * Leaf = non-object, non-array (we treat arrays as leaves; i18n bundles
 * here don't use arrays, but if they did we'd flag mismatched length too).
 */
function* walkLeaves(obj, prefix = []) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    yield { path: prefix.join('.'), value: obj };
    return;
  }
  for (const key of Object.keys(obj)) {
    yield* walkLeaves(obj[key], [...prefix, key]);
  }
}

/** Build a Map<dot.path, value> for a namespace bundle. */
function flatten(bundle) {
  const out = new Map();
  for (const { path, value } of walkLeaves(bundle)) {
    out.set(path, value);
  }
  return out;
}

/** Pretty-print a capped list of offenders. */
function printOffenders(label, items, format = (x) => x) {
  if (items.length === 0) return;
  console.log(`  ${label} (${items.length}):`);
  const cap = 20;
  for (const item of items.slice(0, cap)) {
    console.log(`    - ${format(item)}`);
  }
  if (items.length > cap) {
    console.log(`    … and ${items.length - cap} more`);
  }
}

// ---------- main ----------

function main() {
  // Sanity-check the i18n root.
  let actualLocales;
  try {
    actualLocales = listLocales(I18N_ROOT);
  } catch (err) {
    console.error(`i18n root missing or unreadable: ${I18N_ROOT}`);
    console.error(err.message);
    process.exit(1);
  }

  if (!actualLocales.includes(BASE_LOCALE)) {
    console.error(`base locale "${BASE_LOCALE}" missing in ${I18N_ROOT}`);
    process.exit(1);
  }

  // Warn (don't fail) if there are extra locale dirs we don't audit.
  const knownLocales = new Set([BASE_LOCALE, ...TARGET_LOCALES]);
  const extraLocales = actualLocales.filter((l) => !knownLocales.has(l));
  if (extraLocales.length) {
    console.log(
      `note: untracked locale dirs present (not audited): ${extraLocales.join(', ')}`,
    );
  }

  const baseDir = join(I18N_ROOT, BASE_LOCALE);
  const baseNamespaces = listNamespaces(baseDir);

  let totalFailures = 0;
  const summary = [];

  for (const target of TARGET_LOCALES) {
    const targetDir = join(I18N_ROOT, target);
    let targetNamespaces;
    try {
      targetNamespaces = listNamespaces(targetDir);
    } catch {
      console.error(`target locale dir missing: ${targetDir}`);
      process.exit(1);
    }

    console.log(`\n=== ${BASE_LOCALE} -> ${target} ===`);

    // Namespace-level parity.
    const baseNsSet = new Set(baseNamespaces);
    const targetNsSet = new Set(targetNamespaces);
    const missingNsInTarget = baseNamespaces.filter((n) => !targetNsSet.has(n));
    const missingNsInBase = targetNamespaces.filter((n) => !baseNsSet.has(n));

    if (missingNsInTarget.length || missingNsInBase.length) {
      console.log('\n[namespaces]');
      if (missingNsInTarget.length)
        console.log(
          `  missing in ${target}/: ${missingNsInTarget.join(', ')}`,
        );
      if (missingNsInBase.length)
        console.log(
          `  orphaned in ${target}/ (not in ${BASE_LOCALE}/): ${missingNsInBase.join(', ')}`,
        );
      totalFailures += missingNsInTarget.length + missingNsInBase.length;
    }

    // Key-level parity per shared namespace.
    const sharedNs = baseNamespaces.filter((n) => targetNsSet.has(n));
    for (const ns of sharedNs) {
      const baseFlat = flatten(loadNs(baseDir, ns));
      const targetFlat = flatten(loadNs(targetDir, ns));

      const missingInTarget = [];
      const untranslated = [];
      for (const [key, baseValue] of baseFlat) {
        if (!targetFlat.has(key)) {
          missingInTarget.push(key);
          continue;
        }
        const targetValue = targetFlat.get(key);
        // Empty string, null, or identical to EN ⇒ probably untranslated.
        // Exception: tokens like brand names / acronyms that legitimately
        // match EN (e.g. "AMI", "HUD", a URL). We allow short uppercase
        // tokens (<=5 chars all uppercase) and URLs/emails through.
        if (targetValue === null || targetValue === undefined) {
          untranslated.push({ key, reason: 'null/undefined' });
          continue;
        }
        if (typeof targetValue !== 'string') continue; // numbers, bools — skip
        const trimmed = targetValue.trim();
        if (trimmed === '') {
          untranslated.push({ key, reason: 'empty string' });
          continue;
        }
        if (typeof baseValue === 'string' && trimmed === baseValue.trim()) {
          if (isAllowedIdentical(trimmed)) continue;
          untranslated.push({
            key,
            reason: `identical to ${BASE_LOCALE}: "${truncate(trimmed)}"`,
          });
        }
      }

      const missingInBase = [];
      for (const key of targetFlat.keys()) {
        if (!baseFlat.has(key)) missingInBase.push(key);
      }

      const failures =
        missingInTarget.length + missingInBase.length + untranslated.length;
      if (failures > 0) {
        console.log(`\n[${ns}]`);
        printOffenders(`missing in ${target}`, missingInTarget);
        printOffenders(
          `orphaned in ${target} (no ${BASE_LOCALE} counterpart)`,
          missingInBase,
        );
        printOffenders('untranslated / placeholder', untranslated, (x) =>
          typeof x === 'string' ? x : `${x.key}  [${x.reason}]`,
        );
      }
      totalFailures += failures;
      summary.push({
        namespace: ns,
        missingInTarget: missingInTarget.length,
        orphaned: missingInBase.length,
        untranslated: untranslated.length,
      });
    }
  }

  console.log('\n--- summary ---');
  const colWidths = [18, 14, 10, 14];
  const header = ['namespace', 'missing-es', 'orphan', 'untranslated'];
  console.log(
    header.map((h, i) => h.padEnd(colWidths[i])).join(''),
  );
  for (const row of summary) {
    console.log(
      [
        row.namespace,
        String(row.missingInTarget),
        String(row.orphaned),
        String(row.untranslated),
      ]
        .map((c, i) => c.padEnd(colWidths[i]))
        .join(''),
    );
  }

  if (totalFailures > 0) {
    console.error(
      `\nFAIL: ${totalFailures} i18n parity violation(s). See details above.`,
    );
    process.exit(1);
  }
  console.log('\nOK: EN-ES i18n parity clean.');
}

/**
 * Strings that may legitimately appear identically in EN and ES.
 * Tight heuristic — we want to surface real untranslated copy, not nag about
 * brand names, acronyms, pure-interpolation tokens, or currency formats.
 */
function isAllowedIdentical(s) {
  // URLs and emails.
  if (/^https?:\/\//i.test(s)) return true;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return true;
  // Pure punctuation / single char.
  if (s.length <= 1) return true;
  // ALL-CAPS acronym up to 5 chars (AMI, HUD, FAQ, OK).
  if (/^[A-Z0-9]{2,5}$/.test(s)) return true;
  // Pure-interpolation strings: every non-whitespace token is either an
  // interpolation placeholder ({{x}}), a punctuation separator, or a count
  // suffix like ":". These are display templates, not translatable copy.
  // Strip placeholders and check if anything alphabetic is left.
  const stripped = s.replace(/\{\{[^}]+\}\}/g, '').trim();
  if (stripped === '' || /^[\s\d.,:;/$%#–—\-+()\[\]]*$/.test(stripped)) {
    return true;
  }
  // Currency / numeric formats with no words: "$35.95", "$1,200/mo" — keep.
  if (/^[$€£]?\d[\d.,]*(\s*\/\s*\w+)?$/.test(s)) return true;
  // SSN/ZIP/phone format placeholders.
  if (/^[X#\d\s\-()]+$/.test(s)) return true;
  // Brand / proper nouns / loan-words common in Spanish tech UX.
  const passthrough = new Set([
    'Frank',
    'Frank.',
    'Frank Pilot',
    'frank-pilot',
    'GPMG',
    'HUD',
    'AMI',
    'IMA',
    'FAQ',
    'PDF',
    'OK',
    'NYCHA',
    'LIHTC',
    'FCRA',
    'CDPC',
    'WhatsApp',
    'iOS',
    'Android',
    'Cookies',
    'Marketing',
    'Español',
    'Donna Louise 2',
    '2241 Sunrise Ave',
    '(702) 555-0188',
  ]);
  if (passthrough.has(s)) return true;
  return false;
}

function truncate(s, n = 60) {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1)}…`;
}

main();
