/**
 * corpus.ts — in-repo IDF retriever for the hosted Deal-Room Q&A bot.
 *
 * A faithful TS port of battlestation `lib/corpus.py` (the Corpus class +
 * _tokenize, lines 70-151) — the SAME retriever the local deal bot grounds
 * against. Self-contained: Railway can't reach the Mac's :9000, so retrieval is
 * model-free and reads a committed JSON corpus (built by
 * scripts/build-deal-corpus.mjs from the curated, compartment-safe deal docs).
 *
 * Scoring (verbatim from corpus.py): per-entry token vector with question×3,
 * sectionTitle/section×2, answer×1 (ADDITIVE across fields); idf =
 * log((n+1)/(df+1)) + 1; entry norm = sqrt(Σ (idf·w)²); query score =
 * Σ_{t∈q∩v} idf[t]²·v[t] / norm. Single letters are dropped, digits kept.
 *
 * FAIL-SOFT CONTRACT (mirrors housing-qa/tenant-faq.ts): a missing/corrupt
 * corpus file logs one warning and yields an empty index — the bot degrades to
 * "I don't have that" rather than 500ing the webhook.
 */

import fs from "fs";
import path from "path";
import { logger } from "../../utils/logger";

// __dirname = dist/modules/deal-qa at runtime → repo root is three levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const DEAL_CORPUS_PATH = path.join(REPO_ROOT, "src", "db", "data", "deal-corpus.json");

export interface DealEntry {
  id: string;
  source_ref?: string;
  section?: string;
  sectionTitle?: string;
  question?: string;
  answer: string;
  source?: string;
  status?: string;
  audience?: string;
}

export interface DealHit {
  entry: DealEntry;
  score: number;
}

// Stopwords — ported from corpus.py _STOPWORDS (lib/corpus.py:59-67).
const STOPWORDS = new Set(
  (
    "a an the is are was were be been being to of and or in on for with as at " +
    "by from it this that these those i you we they he she my your our their " +
    "do does did can could would should will if what how when where who why " +
    "which me have has had not no but so about into than then there here any " +
    "some get got im ive"
  ).split(" ")
);

// corpus.py: re.findall(r"[a-z0-9]+", lower); keep tokens len>1 OR all-digits.
function tokenize(text: string): string[] {
  const toks = (text || "").toLowerCase().match(/[a-z0-9]+/g) || [];
  return toks.filter((t) => !STOPWORDS.has(t) && (t.length > 1 || /^\d+$/.test(t)));
}

interface IndexedEntry {
  entry: DealEntry;
  vec: Map<string, number>;
  norm: number;
}

let entriesSingleton: DealEntry[] | null = null;
let indexSingleton: { items: IndexedEntry[]; idf: Map<string, number> } | null = null;

/** Load the deal corpus (fail-soft). Accepts a `{ entries: [...] }` envelope. */
export function getDealEntries(): DealEntry[] {
  if (entriesSingleton !== null) return entriesSingleton;
  try {
    const parsed = JSON.parse(fs.readFileSync(DEAL_CORPUS_PATH, "utf8")) as {
      entries?: unknown;
    };
    const raw = Array.isArray(parsed) ? parsed : parsed.entries;
    if (!Array.isArray(raw)) throw new Error("deal-corpus.json: missing entries[]");
    entriesSingleton = (raw as DealEntry[]).filter(
      (e) =>
        e &&
        typeof e.id === "string" &&
        typeof e.answer === "string" &&
        e.answer.length > 0
    );
  } catch (err) {
    // Fail-soft: the bot runs without the corpus rather than 500ing the webhook.
    logger.warn("deal corpus unavailable — deal-qa retrieval disabled", {
      error: err instanceof Error ? err.message : String(err),
    });
    entriesSingleton = [];
  }
  return entriesSingleton;
}

function getIndex(): { items: IndexedEntry[]; idf: Map<string, number> } {
  if (indexSingleton !== null) return indexSingleton;
  const entries = getDealEntries();

  // Per-entry weighted token vector (question×3, section×2, answer×1, additive).
  const built = entries.map((entry) => {
    const vec = new Map<string, number>();
    const add = (text: string | undefined, w: number) => {
      for (const t of tokenize(text || "")) vec.set(t, (vec.get(t) || 0) + w);
    };
    add(entry.question, 3);
    add(entry.sectionTitle || entry.section, 2);
    add(entry.answer, 1);
    return { entry, vec };
  });

  // Document frequency over distinct tokens per entry → idf.
  const df = new Map<string, number>();
  for (const it of built) for (const t of it.vec.keys()) df.set(t, (df.get(t) || 0) + 1);
  const n = Math.max(1, built.length);
  const idf = new Map<string, number>();
  for (const [t, c] of df) idf.set(t, Math.log((n + 1) / (c + 1)) + 1.0);

  // Pre-compute each entry's norm for cosine-style normalization.
  const items: IndexedEntry[] = built.map((it) => {
    let s = 0;
    for (const [t, w] of it.vec) {
      const d = (idf.get(t) || 0) * w;
      s += d * d;
    }
    return { entry: it.entry, vec: it.vec, norm: Math.sqrt(s) || 1.0 };
  });

  indexSingleton = { items, idf };
  return indexSingleton;
}

// Only approved entries are served (the deal corpus is uniformly operator/approved;
// the compartment guard, not audience, does the partner scoping). Mirrors
// corpus.py _visible's status gate.
function isVisible(e: DealEntry): boolean {
  return (e.status ?? "approved") === "approved";
}

/**
 * Top-`k` deal-corpus passages matching a question, best first. Returns [] for an
 * empty corpus, blank input, or no overlap. Verbatim scoring port of
 * corpus.py Corpus.search (138-151).
 */
export function searchDealCorpus(question: string, k = 5): DealHit[] {
  const q = new Set(tokenize(question));
  if (q.size === 0) return [];
  const { items, idf } = getIndex();
  if (items.length === 0) return [];

  const scored: DealHit[] = [];
  for (const it of items) {
    if (!isVisible(it.entry)) continue;
    let num = 0;
    for (const t of q) {
      const v = it.vec.get(t);
      if (v !== undefined) {
        const id = idf.get(t) || 0;
        num += id * id * v;
      }
    }
    if (num > 0) scored.push({ entry: it.entry, score: num / it.norm });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

/** Test-only: force a reload/rebuild on next access. */
export function _resetDealCorpus(): void {
  entriesSingleton = null;
  indexSingleton = null;
}
