/**
 * compartment-guard.ts — the security core of the hosted Deal-Room Q&A bot.
 *
 * A live, unsupervised Q&A handed to an external/partner contributor (e.g. Slater,
 * token-structuring) must never leak the deal's withhold set. This is a faithful
 * port of battlestation `scripts/claw.py` (_GUARD_CLASSES / TIER_BANNED /
 * guard_answer) and the channel floor in `daemons/dealroom-telegram.py`
 * (effective_tier). Keep the two in sync — the regexes are transcribed VERBATIM.
 *
 * The guard MASKS the banned tokens in a cited answer (so the partner still gets
 * the substance), surfaces what it masked so the operator can widen the
 * compartment deliberately, and FAILS CLOSED (refuses the whole answer) if the
 * tier is unknown or a pattern errors.
 *
 * PYTHON→JS TRANSLATION GOTCHAS (each one is a leak if wrong):
 *  - `re.IGNORECASE` → the `i` flag on every literal.
 *  - GLOBAL REPLACE IS MANDATORY (`g` flag). Python `re.sub` masks *every*
 *    occurrence; JS `String.replace(re, …)` masks only the FIRST unless `re` has
 *    `g`. Without it the first `$5,000` is masked and a later `$700,000` LEAKS.
 *  - We therefore use ONLY `String.replace()`, never `.test()`/`.exec()`, on these
 *    regexes. `replace()` with a `g` regex always scans from 0 and resets
 *    `lastIndex`, so the statefulness that makes `g` dangerous for `.test()`
 *    (and that `housing-qa/output-guard.ts` avoids by forbidding `/g`) is never
 *    observed here. A "hit" is inferred from "did the string change".
 *  - NO `u` flag — JS `\b` is ASCII-only without it (matching Python for these
 *    ASCII inputs); `u` would change handling of the `§ ¢ – —` literals. The `§…`
 *    / `¢` patterns intentionally carry no surrounding `\b` (non-word glyphs).
 *  - Replacement is the literal "[scoped]" (no `$`), so JS `$&`/`$1` specials
 *    don't bite. If the sentinel ever gains a `$`, double it.
 *
 * SEMANTIC DIFFERENCE from `housing-qa/output-guard.ts`: that guard NUKES the
 * whole answer to a fallback on any hit (internal *language* must never appear).
 * This guard MASKS tokens inline and the partner keeps the rest — they are
 * *supposed* to receive the substance, compartment-masked. Only a `blocked`
 * verdict (unknown tier / fault) nukes to a refusal.
 *
 * RESIDUAL RISK (regex can't catch): paraphrase ("51%"→"fifty-one percent"),
 * novel names, public-vs-private % ambiguity. The real controls are the curated
 * compartment-safe corpus + the `privileged` floor; this guard is the backstop.
 */

export type DealTier = "internal" | "privileged" | "ext-named" | "ext-generic";

export const DEAL_TIERS: readonly DealTier[] = [
  "internal",
  "privileged",
  "ext-named",
  "ext-generic",
];

// Partner-facing refusal (Deal-Room voice, never the internal Mr. B framing).
const SCOPED_REFUSAL =
  "📂 That's outside what I can share on this channel — I've flagged it for Alex.";

// Token classes (case-insensitive, global). Ported VERBATIM from claw.py:368-392.
// "Alex" is intentionally NOT masked — a partner deals with Alex directly; the
// compartment hides the deal's internal supply chain, cap-table, and economics.
const GUARD_CLASSES: Record<string, RegExp> = {
  // Internal people / counterparties not handed to an external partner. A static
  // roster can't anticipate every name the corpus holds — the robust control is a
  // SCOPED CORPUS; this is the known-roster backstop.
  names: /\bDonna ?Lou(?:ise)?\b|\bWadsworth\b|\bHoneywell\b|\bKyle\b|\bRitchie\b|\bMohammad ?Hoda\b|\bHoda\b|\bEbru ?Arslan\b|\bArslan\b/gi,
  // Internal cap-table specifics + the ownership reveal.
  cap: /\b51 ?%|\bcap[ -]?table\b|\b100 ?% (?:Frank|founder)[- ]owned/gi,
  // Raw economics / unverified pricing (CPA-attestation-gated): any $ amount, any
  // cents price/range, the participating instrument. Percentages are deliberately
  // NOT blanket-masked (many are public statutory rates a regex can't distinguish).
  econ: /\$\s?\d[\d,]*(?:\.\d+)?\s?[kKmMbB]?\b|\b\d{1,3}(?:[.,]\d+)?\s?(?:¢|cents?\b)|\b\d{2,3}\s?[–—\-]\s?\d{2,3}\s?¢|participating[ -](?:debt|note|loan)|\bv0 hypothesis\b/gi,
  // Legal / structural risk terms — ALLOWED for privileged (Slater's remit), masked above.
  risk_legal: /§ ?385|\bSection 385\b|\bFEOC\b|7701\(e\)\(4\)/gi,
  tribe: /\bChickasaw\b/gi,
};

export const GUARD_CLASS_IDS: readonly string[] = Object.keys(GUARD_CLASSES);

// What each tier must NOT emit. "internal" = no filter (operator). The ladder is a
// strict superset chain: privileged ⊂ ext-named ⊂ ext-generic. Ported from
// claw.py:396-401. A Map so an unknown key yields `undefined` (fail-closed below).
const TIER_BANNED = new Map<string, readonly string[]>([
  ["internal", []],
  ["privileged", ["names", "cap", "econ"]],
  ["ext-named", ["names", "cap", "econ", "risk_legal"]],
  ["ext-generic", ["names", "cap", "econ", "risk_legal", "tribe"]],
]);

// Compartment ordering, least→most restrictive (dealroom-telegram.py:251).
const TIER_RANK: Record<DealTier, number> = {
  internal: 0,
  privileged: 1,
  "ext-named": 2,
  "ext-generic": 3,
};

export function isDealTier(t: unknown): t is DealTier {
  return typeof t === "string" && TIER_BANNED.has(t);
}

/** The withhold set for a tier (empty for internal/unknown — caller decides). */
export function bannedClasses(tier: string): readonly string[] {
  return TIER_BANNED.get((tier || "").trim()) ?? [];
}

export interface GuardResult {
  /** true = nothing was masked. */
  clean: boolean;
  /** Always safe to return (the masked answer, or the refusal). */
  masked: string;
  /** Class ids masked (or a sentinel on a hard block). */
  hits: string[];
  /** true = fail-closed (unknown tier / guard fault). */
  blocked?: boolean;
}

/**
 * Mask a tier's withhold set in a corpus answer. Returns {clean, masked, hits}.
 * Fails CLOSED — an unknown tier or a bad pattern returns a safe refusal, never
 * the raw answer. Verbatim behavior port of claw.py guard_answer (406-425).
 */
export function guardAnswer(text: string, tier: string): GuardResult {
  const banned = TIER_BANNED.get((tier ?? "").trim());
  if (banned === undefined) {
    return {
      clean: false,
      blocked: true,
      hits: [`unknown-tier:${tier}`],
      masked: SCOPED_REFUSAL,
    };
  }
  if (banned.length === 0) {
    // internal / unscoped → straight through.
    return { clean: true, masked: text ?? "", hits: [] };
  }
  try {
    let masked = text ?? "";
    const hits: string[] = [];
    for (const cls of banned) {
      const re = GUARD_CLASSES[cls];
      const next = masked.replace(re, "[scoped]"); // g flag ⇒ ALL occurrences
      if (next !== masked) {
        hits.push(cls);
        masked = next;
      }
    }
    return { clean: hits.length === 0, masked, hits };
  } catch {
    // Defensive: never leak on a guard fault.
    return {
      clean: false,
      blocked: true,
      hits: ["guard-error"],
      masked: SCOPED_REFUSAL,
    };
  }
}

/**
 * The compartment to mask an answer to: the STRICTER (higher rank) of the chat's
 * stored tier and the channel floor. The floor can only TIGHTEN, never widen —
 * so the Deal Room never emits the withhold set, even for a mis-enrolled chat.
 * Port of dealroom-telegram.py effective_tier (364-375).
 */
export function effectiveTier(chatTier: DealTier, floor: DealTier): DealTier {
  return TIER_RANK[chatTier] >= TIER_RANK[floor] ? chatTier : floor;
}

export interface DealVerdict {
  ok: boolean;
  answer: string;
  tier: DealTier;
  maskedClasses: string[];
  blocked: boolean;
}

/** Apply the guard at the effective tier and shape a verdict for the service. */
export function finalizeDealAnswer(eff: DealTier, answer: string): DealVerdict {
  const g = guardAnswer(answer, eff);
  return {
    ok: g.clean,
    answer: normalizeBrand(g.masked),
    tier: eff,
    maskedClasses: g.hits,
    blocked: !!g.blocked,
  };
}

// ── Principal-brand normalization (operator directive 2026-06-26) ─────────────
// The bot presents the sponsor as an ENTITY, never the individual principals:
// "Alex" / "Craig" are rewritten to the principal brand on EVERY answer, at ALL
// tiers. This is a standing PRESENTATION rule, not a compartment redaction, so it
// does not count as a withheld hit / boundary alert. Change the brand in one place.
export const PRINCIPAL_BRAND = "Adinkra Labs";

const PRINCIPAL_NAMES = /\bAlex(?:ander)?(?:\s+Peri)?\b|\bCraig(?:\s+Ellins)?\b/gi;

export function normalizeBrand(text: string): string {
  if (!text) return text;
  let out = text.replace(PRINCIPAL_NAMES, PRINCIPAL_BRAND);
  // Collapse "<brand> and/&/,/+ <brand>" (both principals named together) to one,
  // iterating until stable so longer chains fold down too.
  const pair = new RegExp(
    `${PRINCIPAL_BRAND}\\s*(?:,|and|&|/|\\+)\\s*${PRINCIPAL_BRAND}`,
    "i"
  );
  let prev: string;
  do {
    prev = out;
    out = out.replace(pair, PRINCIPAL_BRAND);
  } while (out !== prev);
  return out;
}
