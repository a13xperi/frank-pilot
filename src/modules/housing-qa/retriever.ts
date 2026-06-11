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
 *
 * ALL routing is gated by a per-surface RetrievalPolicy (see
 * RETRIEVAL_POLICIES): buildContext requires the caller to name its surface,
 * and a source outside that surface's allowlist is never consulted. The
 * public tenant surface is tenantFaq-only — the property index is not even
 * classified against, so statewide records cannot reach the model.
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
// Per-surface retrieval policy — the data-scoping enforcement seam.
//
// Every caller of buildContext MUST name the surface it serves; there is no
// default. A source absent from a policy's allowlist is never consulted — not
// filtered after the fact, not hidden by prompt instruction: the retrieval
// call simply never happens, so scoped-out data cannot reach the model.
//
// Caller audit (2026-06-11): the ONLY consumer of this module is the PUBLIC
// tenant-portal chat widget (client-tenant → POST /api/housing-qa). The staff
// client (client/), acquisition client (client-acq/), and voice-intake module
// do not call housing-qa. Any new caller must pick — or add — a policy here.
// --------------------------------------------------------------------------- //
export type QaSurface = "tenant_public" | "applicant_portal";

/**
 * Retrieval sources the allowlist governs. The always-on `facts` block is NOT
 * a source — it is the platform's own locked public constants ($35.95 fee,
 * 120-day rule, document checklist), emitted on every surface; only its
 * internal provenance fields are policy-controlled (redactInternalProvenance).
 */
export type QaSource = "properties" | "faqSections" | "tenantFaq";

export interface RetrievalPolicy {
  surface: QaSurface;
  /** Source allowlist — a source not listed here is NEVER consulted. */
  sources: readonly QaSource[];
  /** Inject `_meta` (dataset names/counts — internal) into the payload. */
  includeMeta: boolean;
  /**
   * Echo the raw user question inside the context payload. The model already
   * receives the question as the user message; repeating it inside the SYSTEM
   * prompt widens the injection surface, so public surfaces omit it.
   */
  echoQuestion: boolean;
  /** Strip internal provenance (`source` fields naming repo files) from facts. */
  redactInternalProvenance: boolean;
  /** Run the response through the internal-language output guard (routes.ts). */
  guardOutput: boolean;
}

export const RETRIEVAL_POLICIES: Record<QaSurface, RetrievalPolicy> = {
  // Unauthenticated tenant-portal widget: general LIHTC guidance ONLY. No
  // property retrieval of any kind — the statewide HUD-LIHTC index is never
  // even classified against, so no property record, dataset name, or
  // statewide note can enter the payload.
  tenant_public: {
    surface: "tenant_public",
    sources: ["tenantFaq"],
    includeMeta: false,
    echoQuestion: false,
    redactInternalProvenance: true,
    guardOutput: true,
  },
  // The original full grounding contract (named-property / city / attribute /
  // process routing over the merged statewide+GPMG index). No route serves
  // this today — it is the seam for a future AUTHENTICATED applicant surface,
  // and it keeps the locked retrieval contract pinned by the existing tests.
  applicant_portal: {
    surface: "applicant_portal",
    sources: ["properties", "faqSections", "tenantFaq"],
    includeMeta: true,
    echoQuestion: true,
    redactInternalProvenance: false,
    guardOutput: false,
  },
};

/** Facts as emitted to public surfaces — same values, no internal provenance. */
export interface PublicFacts {
  applicationFee: {
    amount: string;
    per: string;
    refundable: boolean;
    note: string;
  };
  rule120: { days: number; note: string };
  documentsNeeded: readonly string[];
  documentsNote: string;
}

// Provenance-free mirror of ALWAYS_ON_FACTS for redactInternalProvenance
// surfaces. Built from the same object so the values can never drift.
const PUBLIC_FACTS: PublicFacts = {
  applicationFee: {
    amount: ALWAYS_ON_FACTS.applicationFee.amount,
    per: ALWAYS_ON_FACTS.applicationFee.per,
    refundable: ALWAYS_ON_FACTS.applicationFee.refundable,
    note: ALWAYS_ON_FACTS.applicationFee.note,
  },
  rule120: {
    days: ALWAYS_ON_FACTS.rule120.days,
    note: ALWAYS_ON_FACTS.rule120.note,
  },
  documentsNeeded: ALWAYS_ON_FACTS.documentsNeeded,
  documentsNote: ALWAYS_ON_FACTS.documentsNote,
};

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
  /** Present only when the policy echoes the question (see echoQuestion). */
  question?: string;
  /** `faq_only` = property retrieval scoped out by policy (tenant surface). */
  routing: Branch | "faq_only";
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
  facts: PublicFacts;
  notes: string[];
  /** Present only when the policy includes meta (see includeMeta). */
  _meta?: {
    statewideRecords: number;
    gpmgRecords: number;
    availableNowRecords: number;
    totalIndexRecords: number;
    dataAsOf: string | null;
  };
}

export function buildContext(
  question: string,
  policy: RetrievalPolicy,
  index: HousingIndex = getHousingIndex()
): HousingContext {
  const allow = new Set<QaSource>(policy.sources);
  const notes: string[] = [];
  let properties: Array<EmittedProperty | CompactProperty> = [];
  let mode: "full" | "compact" | "none" = "none";
  let totalMatching: number | undefined;
  let shown: number | undefined;

  // Source allowlist gate: when `properties` is scoped out, the index is not
  // consulted AT ALL — classification itself runs over the property index, so
  // skipping it is what guarantees no record, name, or dataset note leaks.
  let branch: Branch | "faq_only" = "faq_only";
  let detail: ClassifyDetail = {};
  if (allow.has("properties")) {
    [branch, detail] = classify(question, index);
  }

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
    // process / faq_only
    properties = [];
    mode = "none";
    const unknown = detail.unknownProperty;
    if (unknown) {
      notes.push(
        `The question appears to name a property ('${unknown}') that is NOT in the statewide HUD-LIHTC or available-now data. Refuse: say you don't have a property by that name and point to /discover or contacting GPMG. Do NOT invent details.`
      );
    }
  }

  let faq: FaqMatch[] = [];
  if (allow.has("faqSections")) {
    faq = matchFaqSections(question);
    if (faq.length === 0) {
      faq = [
        {
          id: "application-steps",
          title: "The application steps",
          anchor: "faq.md#application-steps",
        },
      ];
    }
  }

  // Cap 2 only when property objects share the payload (property data stays
  // dominant); 4 on property-free routes — including the tenant surface,
  // where tenantFaq is the primary grounding source.
  const tenantFaq = allow.has("tenantFaq")
    ? matchTenantFaq(
        question,
        branch === "process" || branch === "faq_only" ? 4 : 2
      )
    : [];

  const ctx: HousingContext = {
    routing: branch,
    propertyMode: mode,
    properties,
    totalMatching,
    shown,
    faqSections: faq,
    tenantFaq,
    facts: policy.redactInternalProvenance ? PUBLIC_FACTS : ALWAYS_ON_FACTS,
    notes,
  };
  if (policy.echoQuestion) ctx.question = question;
  if (policy.includeMeta) {
    ctx._meta = {
      statewideRecords: index.statewideCount,
      gpmgRecords: index.gpmgCount,
      availableNowRecords: index.availableNowCount,
      totalIndexRecords: index.records.length,
      dataAsOf: index.gpmgSnapshot,
    };
  }
  return ctx;
}
