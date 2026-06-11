/**
 * retriever.ts — Grounded retrieval: classify → match → assemble context.
 *
 * Ported from tools/housing-qa/retriever.py. The two-layer data merge lives in
 * data.ts; this module classifies a question into one of four routing branches
 * and assembles the context payload per the LOCKED grounding contract.
 *
 * Fuse.js replaces difflib.SequenceMatcher for the user-facing property-name
 * fuzzy match (fuzzy_property). The internal GPMG↔statewide merge ratio stays
 * in data.ts (seqRatio) for faithfulness to the Python merge.
 *
 * Routing branches:
 *   - named property      -> 1 FULL normalized object
 *   - city/area           -> COMPACT summaries, cap K=8
 *   - attribute filter    -> COMPACT summaries, cap K=8 (city+attribute = AND)
 *   - process/eligibility -> NO property objects; FAQ sections only
 */

import Fuse from "fuse.js";
import {
  getHousingIndex,
  HousingIndex,
  NormalizedProperty,
  normName,
  nameTokens,
  K_COMPACT,
} from "./data";
import { matchFaqSections, FaqMatch } from "./faq";
import { matchTenantFaq, TenantFaqMatch } from "./tenant-faq";

// --------------------------------------------------------------------------- //
// Always-on facts block (grounded in apply.json copy) — mirrors retriever.py
// --------------------------------------------------------------------------- //
export const ALWAYS_ON_FACTS = {
  applicationFee: {
    amount: "$35.95",
    per: "per adult 18+",
    refundable: false,
    note:
      "Non-refundable. Locks your spot on the waitlist. Covers credit and background checks.",
    source: "apply.json checklist.fee / household.disclaimer",
  },
  rule120: {
    days: 120,
    note:
      "Your application stays active for 120 days. If you can't be housed in that window, you're invited to refresh and continue.",
    source: "apply.json checklist.rule120",
  },
  documentsNeeded: [
    "Government-issued photo ID",
    "Proof of income (last 2 pay stubs or offer letter)",
    "Social Security Number or ITIN",
    "Two prior landlord references (last 3 years)",
    "Household composition (everyone moving in)",
  ],
  documentsNote: "Upload your documents (5 files, < 120 days old).",
  documentsSource: "apply.json checklist.items / confirm.nextSteps",
} as const;

// --------------------------------------------------------------------------- //
// Fuzzy property matching (Fuse.js — replaces difflib)
// --------------------------------------------------------------------------- //
interface FuseEntry {
  rec: NormalizedProperty;
  name: string;
  aka: string;
  idName: string;
}

const fuseCache = new WeakMap<HousingIndex, Fuse<FuseEntry>>();

function getFuse(index: HousingIndex): Fuse<FuseEntry> {
  let f = fuseCache.get(index);
  if (f) return f;
  const entries: FuseEntry[] = index.records.map((rec) => ({
    rec,
    name: normName(rec.name),
    aka: normName((rec._aka || "").replace(/-/g, " ")),
    idName: normName((rec.id || "").replace(/-/g, " ")),
  }));
  f = new Fuse(entries, {
    includeScore: true,
    threshold: 0.5,
    ignoreLocation: true,
    minMatchCharLength: 2,
    keys: [
      { name: "name", weight: 0.6 },
      { name: "aka", weight: 0.2 },
      { name: "idName", weight: 0.2 },
    ],
  });
  fuseCache.set(index, f);
  return f;
}

/**
 * Return [best record, score in 0..1] matching a property name, or [null,
 * bestScore]. Score is a blend of token overlap, substring containment, and
 * Fuse similarity — kept on the same 0.6/0.72/0.78 thresholds the Python tool
 * used. Mirrors HousingIndex.fuzzy_property.
 */
export function fuzzyProperty(
  index: HousingIndex,
  query: string
): [NormalizedProperty | null, number] {
  const qFull = normName(query);
  const qTokens = nameTokens(query);
  if (!qFull) return [null, 0];

  const fuse = getFuse(index);
  // Fuse for candidate ranking; we still compute the python-equivalent score
  // on the top candidates so thresholds line up with the ported behavior.
  const results = fuse.search(qFull, { limit: 25 });

  let best: NormalizedProperty | null = null;
  let bestScore = 0;

  const candidates =
    results.length > 0 ? results.map((r) => r.item) : [];
  // If Fuse found nothing (rare for very short queries), fall back to scanning
  // all records so we never silently miss a containment match.
  const pool: FuseEntry[] =
    candidates.length > 0
      ? candidates
      : index.records.map((rec) => ({
          rec,
          name: normName(rec.name),
          aka: normName((rec._aka || "").replace(/-/g, " ")),
          idName: normName((rec.id || "").replace(/-/g, " ")),
        }));

  for (const entry of pool) {
    const candNames = [entry.name, entry.aka, entry.idName];
    let localBest = 0;
    for (const cFull of candNames) {
      if (!cFull) continue;
      const cTokens = nameTokens(cFull);
      const overlap =
        qTokens.size && cTokens.size
          ? jaccard(qTokens, cTokens)
          : 0;
      const contains = qFull && cFull.includes(qFull) ? 1 : 0;
      // Fuse-based ratio for this candidate string.
      const ratio = stringSimilarity(qFull, cFull);
      const score = Math.max(
        ratio,
        0.6 * overlap + 0.4 * ratio,
        contains * 0.95
      );
      if (score > localBest) localBest = score;
    }
    if (localBest > bestScore) {
      bestScore = localBest;
      best = entry.rec;
    }
  }
  if (best !== null && bestScore >= 0.6) return [best, bestScore];
  return [null, bestScore];
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}

/**
 * Lightweight bigram Dice coefficient — a stable difflib.ratio()-style
 * similarity for the single-candidate scoring above. (Fuse provides ranking;
 * this provides the numeric score the thresholds were tuned against.)
 */
function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bigrams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2);
      m.set(bg, (m.get(bg) || 0) + 1);
    }
    return m;
  };
  const ma = bigrams(a);
  const mb = bigrams(b);
  let inter = 0;
  for (const [bg, count] of ma) {
    const other = mb.get(bg) || 0;
    inter += Math.min(count, other);
  }
  return (2 * inter) / (a.length - 1 + (b.length - 1));
}

// --------------------------------------------------------------------------- //
// Attribute detection — mirrors retriever.py detectors
// --------------------------------------------------------------------------- //
const AMI_RE = /(\d{2,3})\s*%/;

function detectAmiTier(q: string): string | null {
  const m = AMI_RE.exec(q);
  return m ? `${m[1]}%` : null;
}

function detectBedrooms(q: string): string | null {
  const ql = q.toLowerCase();
  if (ql.includes("studio")) return "studio";
  const m = /\b(\d)\s*(?:br|bed)/.exec(ql);
  if (m) return `${m[1]}br`;
  return null;
}

function detectType(q: string): string | null {
  const ql = q.toLowerCase();
  if (/\bsenior(s)?\b|\belder|\b55\+|\b62\+/.test(ql)) return "senior";
  if (/\bfamily\b|\bfamilies\b/.test(ql)) return "family";
  return null;
}

function wantsAvailableNow(q: string): boolean {
  const ql = q.toLowerCase();
  return /available\s*now|available today|right now|currently available|open now|move in now|vacan/.test(
    ql
  );
}

// --------------------------------------------------------------------------- //
// Attribute filter — mirrors HousingIndex.filter_attributes
// --------------------------------------------------------------------------- //
function filterAttributes(
  index: HousingIndex,
  opts: {
    ptype?: string | null;
    amiTier?: string | null;
    availableNow?: boolean;
    bedrooms?: string | null;
    city?: string | null;
  }
): NormalizedProperty[] {
  const cnorm = opts.city ? normName(opts.city) : null;
  const out: NormalizedProperty[] = [];
  for (const r of index.records) {
    if (cnorm && normName(r.city) !== cnorm) continue;
    if (opts.ptype) {
      const rt = normName(r.type);
      if (!rt.includes(normName(opts.ptype))) continue;
    }
    if (opts.amiTier) {
      const tiers = r.amiTiers || [];
      const normTiers = new Set(
        tiers.map((t) => t.replace(/%/g, "").trim())
      );
      if (!normTiers.has(opts.amiTier.replace(/%/g, "").trim())) continue;
    }
    if (opts.availableNow && r.availability.status !== "available_now")
      continue;
    if (opts.bedrooms) {
      const ut = r.unitTypes || [];
      const joined = ut.join(" ").toLowerCase();
      if (!joined.includes(opts.bedrooms.toLowerCase())) continue;
    }
    out.push(r);
  }
  return out;
}

// --------------------------------------------------------------------------- //
// Property-phrase extraction + unknown-property heuristic — mirror retriever.py
// --------------------------------------------------------------------------- //
function extractPropertyPhrase(q: string): string {
  let s = q.trim().replace(/[?.!]+$/, "");
  const patterns = [
    /^(?:can you )?tell me (?:about|more about)\s+/i,
    /^(?:what(?:'s| is| are)?)\s+(?:the\s+)?(?:[\w\s/-]+?)\s+(?:at|for|of)\s+/i,
    /^(?:do|does)\s+(?:you|they)\s+(?:have|offer|allow)\s+/i,
    /^(?:what about|how about|info on|information (?:about|on)|details (?:about|on))\s+/i,
    /^(?:is|are)\s+(?:there\s+)?/i,
    /^(?:i(?:'m| am)?\s+(?:looking|interested)\s+(?:for|in)\s+)/i,
  ];
  for (const p of patterns) {
    const next = s.replace(p, "");
    if (next !== s) {
      s = next.trim();
      break;
    }
  }
  return s.trim();
}

function looksLikeUnknownProperty(
  q: string,
  prop: NormalizedProperty | null,
  score: number
): string | null {
  if (prop !== null && score >= 0.6) return null;
  let m = /\b(?:about|at|for|regarding|tell me about)\s+([A-Z][\w'.-]+(?:\s+[A-Z][\w'.-]+){0,4})/.exec(
    q
  );
  if (m) return m[1].trim();
  m = /\b([A-Z][\w'.-]+(?:\s+[A-Z][\w'.-]+){0,3}\s+(?:Apartments?|Apts?|Towers?|Village|Court|Place|Community|Homes?))\b/.exec(
    q
  );
  if (m) return m[1].trim();
  return null;
}

// --------------------------------------------------------------------------- //
// Classification — mirrors retriever.classify
// --------------------------------------------------------------------------- //
export type Branch = "named_property" | "city" | "attribute" | "process";

export interface ClassifyDetail {
  record?: NormalizedProperty;
  score?: number;
  city?: string | null;
  ami?: string | null;
  bedrooms?: string | null;
  type?: string | null;
  available_now?: boolean;
  unknownProperty?: string | null;
}

export function classify(
  question: string,
  index: HousingIndex = getHousingIndex()
): [Branch, ClassifyDetail] {
  const q = question.trim();
  const ql = q.toLowerCase();

  let [prop, score] = fuzzyProperty(index, q);
  const phrase = extractPropertyPhrase(q);
  if (phrase && phrase.toLowerCase() !== ql) {
    const [p2, s2] = fuzzyProperty(index, phrase);
    if (p2 !== null && s2 > score) {
      prop = p2;
      score = s2;
    }
  }

  const citiesLower = new Set(index.allCities().map((c) => c.toLowerCase()));
  const looksLikeCityOnly =
    citiesLower.has(ql) || citiesLower.has(normName(phrase));

  let cityHit: string | null = null;
  for (const c of index.allCities()) {
    const re = new RegExp(`\\b${escapeRegExp(c.toLowerCase())}\\b`);
    if (re.test(ql)) {
      cityHit = c;
      break;
    }
  }

  const ami = detectAmiTier(q);
  const br = detectBedrooms(q);
  const ptype = detectType(q);
  const avail = wantsAvailableNow(q);

  if (prop !== null && score >= 0.72 && !looksLikeCityOnly) {
    return ["named_property", { record: prop, score }];
  }

  if (
    (ami || br || ptype || avail) &&
    !(prop !== null && score >= 0.78)
  ) {
    return [
      "attribute",
      {
        ami,
        bedrooms: br,
        type: ptype,
        available_now: avail,
        city: cityHit,
      },
    ];
  }

  if (cityHit) {
    return ["city", { city: cityHit }];
  }

  if (prop !== null && score >= 0.62 && !looksLikeCityOnly) {
    return ["named_property", { record: prop, score }];
  }

  const unknownProp = looksLikeUnknownProperty(q, prop, score);
  return ["process", { unknownProperty: unknownProp }];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// --------------------------------------------------------------------------- //
// Emit helpers — mirror retriever._strip_internal / _compact
// --------------------------------------------------------------------------- //
type EmittedProperty = Omit<NormalizedProperty, "_lat" | "_lng" | "_aka">;

function stripInternal(rec: NormalizedProperty): EmittedProperty {
  const { _lat, _lng, _aka, ...rest } = rec;
  void _lat;
  void _lng;
  void _aka;
  return rest;
}

export interface CompactProperty {
  name: string | null;
  city: string | null;
  availability: string;
  amiTiers: string[] | null;
  type: string | null;
}

function compact(rec: NormalizedProperty): CompactProperty {
  return {
    name: rec.name,
    city: rec.city,
    availability: rec.availability.status,
    amiTiers: rec.amiTiers,
    type: rec.type,
  };
}

// --------------------------------------------------------------------------- //
// Context assembly — mirrors retriever.build_context
// --------------------------------------------------------------------------- //
export interface HousingContext {
  question: string;
  routing: Branch;
  propertyMode: "full" | "compact" | "none";
  properties: Array<EmittedProperty | CompactProperty>;
  /**
   * Compact routes only (city / attribute): the TRUE number of matching
   * records before the K_COMPACT display cap, and how many actually reached
   * the model. When `totalMatching > shown` the list is truncated and the
   * prompt MUST disclose "N of TOTAL" (issue #224). Undefined for full/none.
   */
  totalMatching?: number;
  shown?: number;
  faqSections: FaqMatch[];
  /**
   * Tenant FAQ corpus matches — FULL question+answer text (unlike faqSections,
   * which are references only). General LIHTC guidance, citable as
   * `(Tenant FAQ #N)`; always-on facts and property data take precedence on
   * any conflict. Capped at 4 on process routes, 2 when properties are
   * injected so property data stays dominant.
   */
  tenantFaq: TenantFaqMatch[];
  facts: typeof ALWAYS_ON_FACTS;
  notes: string[];
  _meta: {
    statewideRecords: number;
    gpmgRecords: number;
    availableNowRecords: number;
    totalIndexRecords: number;
    dataAsOf: string | null;
  };
}

// --------------------------------------------------------------------------- //
// Tenant-scoped context — the DEFAULT for the public endpoint
// --------------------------------------------------------------------------- //

/**
 * What the tenant-widget path is allowed to see: tenant FAQ corpus matches +
 * the always-on platform facts WITH their internal `source` fields stripped
 * (they name repo files). No property index, no classification, no dataset
 * counts — the statewide source must be structurally unreachable from this
 * path, not merely prompted away.
 */
export interface TenantScopedContext {
  question: string;
  scope: "tenant";
  tenantFaq: TenantFaqMatch[];
  facts: {
    applicationFee: {
      amount: string;
      per: string;
      refundable: boolean;
      note: string;
    };
    rule120: { days: number; note: string };
    documentsNeeded: readonly string[];
    documentsNote: string;
  };
}

export function buildTenantContext(question: string): TenantScopedContext {
  const { applicationFee, rule120, documentsNeeded, documentsNote } =
    ALWAYS_ON_FACTS;
  return {
    question,
    scope: "tenant",
    // Same cap the process branch uses, so the rehearsed FAQ answers retrieve
    // exactly as before.
    tenantFaq: matchTenantFaq(question, 4),
    facts: {
      applicationFee: {
        amount: applicationFee.amount,
        per: applicationFee.per,
        refundable: applicationFee.refundable,
        note: applicationFee.note,
      },
      rule120: { days: rule120.days, note: rule120.note },
      documentsNeeded,
      documentsNote,
    },
  };
}

export function buildContext(
  question: string,
  index: HousingIndex = getHousingIndex()
): HousingContext {
  const [branch, detail] = classify(question, index);
  const notes: string[] = [];
  let properties: Array<EmittedProperty | CompactProperty> = [];
  let mode: "full" | "compact" | "none" = "none";
  let totalMatching: number | undefined;
  let shown: number | undefined;

  if (branch === "named_property") {
    const rec = detail.record!;
    properties = [stripInternal(rec)];
    mode = "full";
    if (rec.availability.status === "statewide_only") {
      notes.push(
        `'${rec.name}' is in the statewide HUD-LIHTC dataset only (no available-now feed). Rent, contact, amenities, pet policy, office hours are NOT in the data — refuse + point to next step.`
      );
    }
  } else if (branch === "city") {
    const recs = index.byCity(detail.city!);
    recs.sort(
      (a, b) =>
        (a.availability.status === "available_now" ? 0 : 1) -
        (b.availability.status === "available_now" ? 0 : 1)
    );
    properties = recs.slice(0, K_COMPACT).map(compact);
    mode = "compact";
    totalMatching = recs.length;
    shown = properties.length;
    if (recs.length > K_COMPACT) {
      notes.push(
        `${recs.length} properties in ${detail.city}; showing first ${K_COMPACT}.`
      );
    }
    if (recs.length === 0) {
      notes.push(`No properties found for city '${detail.city}' in the data.`);
    }
  } else if (branch === "attribute") {
    const recs = filterAttributes(index, {
      ptype: detail.type,
      amiTier: detail.ami,
      availableNow: detail.available_now,
      bedrooms: detail.bedrooms,
      city: detail.city,
    });
    recs.sort(
      (a, b) =>
        (a.availability.status === "available_now" ? 0 : 1) -
        (b.availability.status === "available_now" ? 0 : 1)
    );
    properties = recs.slice(0, K_COMPACT).map(compact);
    mode = "compact";
    totalMatching = recs.length;
    shown = properties.length;
    const scope = detail.city ? ` in ${detail.city}` : "";
    if (recs.length > K_COMPACT) {
      notes.push(`${recs.length} matches${scope}; showing first ${K_COMPACT}.`);
    }
    if (recs.length === 0) {
      notes.push("No properties match those attributes in the data.");
    }
    if (detail.bedrooms) {
      notes.push(
        "Bedroom counts are only known for the 17 available-now (GPMG) properties via unitTypes; statewide-only records have no bedroom data."
      );
    }
  } else {
    // process
    properties = [];
    mode = "none";
    const unknown = detail.unknownProperty;
    if (unknown) {
      notes.push(
        `The question appears to name a property ('${unknown}') that is NOT in the statewide HUD-LIHTC or available-now data. Refuse: say you don't have a property by that name and point to /discover or contacting GPMG. Do NOT invent details.`
      );
    }
  }

  let faq = matchFaqSections(question);
  if (faq.length === 0) {
    faq = [
      {
        id: "application-steps",
        title: "The application steps",
        anchor: "faq.md#application-steps",
      },
    ];
  }

  const tenantFaq = matchTenantFaq(question, branch === "process" ? 4 : 2);

  return {
    question,
    routing: branch,
    propertyMode: mode,
    properties,
    totalMatching,
    shown,
    faqSections: faq,
    tenantFaq,
    facts: ALWAYS_ON_FACTS,
    notes,
    _meta: {
      statewideRecords: index.statewideCount,
      gpmgRecords: index.gpmgCount,
      availableNowRecords: index.availableNowCount,
      totalIndexRecords: index.records.length,
      dataAsOf: index.gpmgSnapshot,
    },
  };
}
