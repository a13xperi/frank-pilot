/**
 * tenant-faq.ts — Tenant FAQ corpus retrieval for the grounded housing Q&A
 * agent.
 *
 * Corpus: src/db/data/tenant-faq.json — 190 entries covering the 500-question
 * GPMG LV LIHTC tenant FAQ (built by scripts/build-tenant-faq.mjs from
 * docs/intel/tenant-faq-source.txt; sanitized — no dollar figures, no
 * year-pinned data, nothing contradicting the always-on platform facts).
 *
 * Unlike faq.ts (which injects only section *references*), matches here carry
 * the FULL question + answer text into the context payload, citable as
 * `(Tenant FAQ #N)` via the entry's `label`. These are GENERAL LIHTC guidance —
 * the prompt's precedence rule makes always-on facts and property data win on
 * any conflict.
 *
 * Matching is IDF-weighted token overlap (question hits 3x, section title
 * 1.5x, answer 1x), in the same keyword-scoring spirit as faq.ts. Fuse.js was
 * evaluated and rejected here: whole-sentence fuzzy matching mis-ranked badly
 * (e.g. "deposit in installments" → the cash-jobs entry) because bitap pattern
 * similarity is not sentence similarity.
 *
 * FAIL-SOFT CONTRACT: a missing/corrupt corpus file can never break the
 * endpoint — the loader logs one warning and returns [], degrading the agent
 * to exactly its pre-corpus behavior.
 */

import fs from "fs";
import path from "path";
import { logger } from "../../utils/logger";

// __dirname = src/modules/housing-qa -> repo root is three levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const TENANT_FAQ_PATH = path.join(
  REPO_ROOT,
  "src",
  "db",
  "data",
  "tenant-faq.json"
);

export interface TenantFaqEntry {
  id: string;
  label: string;
  section: string;
  sectionTitle: string;
  sourceNumbers: { from: number; to: number };
  question: string;
  answer: string;
}

/** What reaches the model — full text, citable via `label`. */
export interface TenantFaqMatch {
  id: string;
  label: string;
  sectionTitle: string;
  question: string;
  answer: string;
}

// --------------------------------------------------------------------------- //
// Tokenization — corpus-specific stopwords; digits kept ("section 8", "401k")
// --------------------------------------------------------------------------- //
const STOPWORDS = new Set(
  (
    "a an the and or but do does did i you my your me we our us is are am " +
    "be been was were can could will would should shall may might must " +
    "have has had what when where which who whom how why if in on at to " +
    "for of with from by about as into like through after before between " +
    "out against during without under around among it its this that these " +
    "those there here not no yes than then so too very just also still " +
    "get got need needs"
  ).split(" ")
);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => (t.length > 2 || /^\d+$/.test(t)) && !STOPWORDS.has(t));
}

// --------------------------------------------------------------------------- //
// Corpus load (fail-soft) + scoring index — module-scope singletons
// --------------------------------------------------------------------------- //
interface IndexedEntry {
  entry: TenantFaqEntry;
  qTokens: Set<string>;
  sTokens: Set<string>;
  aTokens: Set<string>;
}

let entriesSingleton: TenantFaqEntry[] | null = null;
let indexSingleton: { items: IndexedEntry[]; idf: Map<string, number> } | null =
  null;

export function getTenantFaqEntries(): TenantFaqEntry[] {
  if (entriesSingleton !== null) return entriesSingleton;
  try {
    const parsed = JSON.parse(fs.readFileSync(TENANT_FAQ_PATH, "utf8")) as {
      entries?: unknown;
    };
    if (!Array.isArray(parsed.entries)) {
      throw new Error("tenant-faq.json: missing entries[]");
    }
    entriesSingleton = (parsed.entries as TenantFaqEntry[]).filter(
      (e) =>
        e &&
        typeof e.id === "string" &&
        typeof e.label === "string" &&
        typeof e.question === "string" &&
        typeof e.answer === "string" &&
        e.question.length > 0 &&
        e.answer.length > 0
    );
  } catch (err) {
    // Fail-soft: the agent runs without the corpus rather than 500ing.
    logger.warn("tenant-faq corpus unavailable — tenantFaq retrieval disabled", {
      error: err instanceof Error ? err.message : String(err),
    });
    entriesSingleton = [];
  }
  return entriesSingleton;
}

function getIndex(): { items: IndexedEntry[]; idf: Map<string, number> } {
  if (indexSingleton !== null) return indexSingleton;
  const entries = getTenantFaqEntries();
  const items: IndexedEntry[] = entries.map((entry) => ({
    entry,
    qTokens: new Set(tokenize(entry.question)),
    sTokens: new Set(tokenize(entry.sectionTitle)),
    aTokens: new Set(tokenize(entry.answer)),
  }));
  const df = new Map<string, number>();
  for (const it of items) {
    const all = new Set([...it.qTokens, ...it.sTokens, ...it.aTokens]);
    for (const t of all) df.set(t, (df.get(t) || 0) + 1);
  }
  const n = items.length || 1;
  const idf = new Map<string, number>();
  for (const [t, count] of df) idf.set(t, Math.log(1 + n / count));
  indexSingleton = { items, idf };
  return indexSingleton;
}

// Minimum score for a match to reach the model — below this it's noise (a
// couple of common-token hits), and spending context tokens on it buys
// nothing. Tuned on the 12-query relevance set in housing-qa-tenant-faq.test.ts.
const MIN_SCORE = 4;

/**
 * Top-`cap` tenant-FAQ entries matching a question, best first, full text.
 * Returns [] for an empty corpus, blank input, or no adequate match.
 */
export function matchTenantFaq(question: string, cap = 4): TenantFaqMatch[] {
  const queryTokens = [...new Set(tokenize(question))];
  if (queryTokens.length === 0 || cap <= 0) return [];
  const { items, idf } = getIndex();
  if (items.length === 0) return [];

  const scored: Array<{ entry: TenantFaqEntry; score: number }> = [];
  for (const it of items) {
    let score = 0;
    for (const t of queryTokens) {
      const w = idf.get(t) || 0;
      if (it.qTokens.has(t)) score += 3 * w;
      else if (it.sTokens.has(t)) score += 1.5 * w;
      else if (it.aTokens.has(t)) score += w;
    }
    if (score >= MIN_SCORE) scored.push({ entry: it.entry, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, cap).map(({ entry }) => ({
    id: entry.id,
    label: entry.label,
    sectionTitle: entry.sectionTitle,
    question: entry.question,
    answer: entry.answer,
  }));
}

/** Test-only: force a reload/rebuild on next access. */
export function _resetTenantFaq(): void {
  entriesSingleton = null;
  indexSingleton = null;
}
