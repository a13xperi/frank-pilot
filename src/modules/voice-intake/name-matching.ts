/**
 * name-matching.ts — fuzzy roster name matching so Frank stops mishearing names.
 *
 * Phone agents routinely mishear surnames ("Hamamona" for "Hamomona", "Evans"
 * vs "Owens"). When the caller spells their last name we want a defensible,
 * deterministic match against the GPM waitlist roster BEFORE we treat the caller
 * as a known applicant — never a silent guess.
 *
 * Algorithm: difflib.SequenceMatcher.ratio() (Ratcliff/Obershelp), copied from
 * the LOCKED `seqRatio` in housing-qa/data.ts so the same similarity math powers
 * both the property merge and this voice path. We score on TWO components — the
 * last token (the spelled surname is the strong signal) and the full name — and
 * take the max, so a good surname match wins even when Frank flubs the first
 * name. Fuse.js is available (housing-qa/retriever.ts uses it for the
 * user-facing property lookup) but a 62-row roster scored on a faithful
 * difflib ratio is both cheaper and exactly auditable here.
 */

/**
 * difflib.SequenceMatcher.ratio() equivalent (Ratcliff/Obershelp). Copied from
 * src/modules/housing-qa/data.ts — kept byte-faithful to the Python tool so the
 * grounding contract stays identical across modules.
 */
export function seqRatio(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const matches = matchingBlocksTotal(a, b);
  return (2 * matches) / (a.length + b.length);
}

function matchingBlocksTotal(a: string, b: string): number {
  // Recursive longest-matching-block sum, as in difflib.
  if (!a || !b) return 0;
  let bestI = 0;
  let bestJ = 0;
  let bestSize = 0;
  // j2len: length of longest match ending at b[j]
  const bIndex = new Map<string, number[]>();
  for (let j = 0; j < b.length; j++) {
    const arr = bIndex.get(b[j]);
    if (arr) arr.push(j);
    else bIndex.set(b[j], [j]);
  }
  let j2len = new Map<number, number>();
  for (let i = 0; i < a.length; i++) {
    const newJ2len = new Map<number, number>();
    const js = bIndex.get(a[i]);
    if (js) {
      for (const j of js) {
        const k = (j > 0 ? j2len.get(j - 1) || 0 : 0) + 1;
        newJ2len.set(j, k);
        if (k > bestSize) {
          bestI = i - k + 1;
          bestJ = j - k + 1;
          bestSize = k;
        }
      }
    }
    j2len = newJ2len;
  }
  if (bestSize === 0) return 0;
  return (
    bestSize +
    matchingBlocksTotal(a.slice(0, bestI), b.slice(0, bestJ)) +
    matchingBlocksTotal(a.slice(bestI + bestSize), b.slice(bestJ + bestSize))
  );
}

export interface RosterEntry {
  full_name: string;
}

export interface FuzzyNameResult {
  match: { full_name: string } | null;
  confidence: number;
}

/** Lowercase, strip punctuation, collapse whitespace — mirrors normName. */
function normalize(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Last whitespace-delimited token of a normalized name (the surname signal). */
function lastToken(normalized: string): string {
  if (!normalized) return "";
  const parts = normalized.split(" ");
  return parts[parts.length - 1] ?? "";
}

/**
 * Fuzzy-match a heard/spelled name against the roster.
 *
 * @param heard        what ASR transcribed for the full name (may be empty)
 * @param spelled      the spelled-back last name (the strong signal; may be empty)
 * @param roster       roster rows carrying `full_name`
 * @param threshold    minimum confidence to return a match (default 0.6)
 *
 * Scoring per candidate = max(
 *   seqRatio(spelled_last, candidate_last),
 *   seqRatio(heard_full,  candidate_full)
 * ). The best candidate STRICTLY ABOVE `threshold` wins; otherwise null with
 * the best (sub-threshold) confidence surfaced so the caller can re-ask.
 * Strictly-above (not ">=") is deliberate: a name sitting exactly at the floor
 * (e.g. "Evans" vs "Owens" both score 0.6) is too weak to auto-accept — it gets
 * rejected so the agent re-asks rather than silently mis-identifying a caller.
 */
export function fuzzyMatchName(
  heard: string | null | undefined,
  spelled: string | null | undefined,
  roster: RosterEntry[],
  threshold = 0.6
): FuzzyNameResult {
  const heardFull = normalize(heard);
  const spelledLast = lastToken(normalize(spelled));

  let best: RosterEntry | null = null;
  let bestScore = 0;

  for (const entry of roster) {
    const candidateFull = normalize(entry.full_name);
    if (!candidateFull) continue;
    const candidateLast = lastToken(candidateFull);

    const lastScore = spelledLast ? seqRatio(spelledLast, candidateLast) : 0;
    const fullScore = heardFull ? seqRatio(heardFull, candidateFull) : 0;
    const score = Math.max(lastScore, fullScore);

    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }

  const confidence = Number(bestScore.toFixed(2));
  if (best !== null && bestScore > threshold) {
    return { match: { full_name: best.full_name }, confidence };
  }
  return { match: null, confidence };
}
