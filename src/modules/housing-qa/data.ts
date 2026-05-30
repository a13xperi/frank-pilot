/**
 * data.ts — Load + merge the two housing datasets into the normalized index.
 *
 * Ported from tools/housing-qa/retriever.py (HousingIndex + helpers). Keeps the
 * LOCKED grounding contract: per-field provenance, `null` for any field absent
 * in source — NEVER invent. The built index is cached in module scope (build
 * once).
 *
 * Datasets (resolved relative to repo root):
 *   1. STATEWIDE HUD-LIHTC base : client-tenant/public/nv-housing-props.json
 *      (335 records). Falls back to src/db/data/nv-housing-props.json — kept in
 *      sync with the primary (same records + amiTiers) so a missing primary
 *      degrades gracefully, never to all-null AMI data.
 *   2. AVAILABLE-NOW (GPMG)     : docs/intel/gpmglv-properties-extracted.json
 *      (dict; property list under "properties", 17 records).
 *
 * AMI-tier provenance (issue #225): 254/335 statewide records carry amiTiers,
 * enriched from the NHD-LIHD set-aside source via scripts/enrich-ami-tiers.py. The
 * remaining ~81 are HUD-LIHTC properties with no NHD-LIHD counterpart (a
 * different property universe, ~133 overlap) — their AMI tier is legitimately
 * unknown, normalized to `null`, and surfaced as "not in our data" (NOT an
 * empty `[]` and NEVER invented). Enrichment has converged: re-running the
 * script fills 0 additional. This is a data-completeness limit, not a grounding
 * leak — locked by the AMI-provenance tests in housing-qa-retriever.test.ts.
 */

import fs from "fs";
import path from "path";

// __dirname = src/modules/housing-qa -> repo root is three levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const STATEWIDE_PRIMARY = path.join(
  REPO_ROOT,
  "client-tenant",
  "public",
  "nv-housing-props.json"
);
const STATEWIDE_FALLBACK = path.join(
  REPO_ROOT,
  "src",
  "db",
  "data",
  "nv-housing-props.json"
);
const GPMG_PATH = path.join(
  REPO_ROOT,
  "docs",
  "intel",
  "gpmglv-properties-extracted.json"
);

export const K_COMPACT = 8; // cap on compact summaries injected

// --------------------------------------------------------------------------- //
// Normalization helpers (mirror retriever.py)
// --------------------------------------------------------------------------- //
const STOPWORDS = new Set([
  "apartments", "apartment", "apts", "apt", "community", "communities",
  "senior", "family", "the", "at", "of", "housing", "homes", "home",
  "village", "court", "courts", "place", "gardens", "garden",
]);

export function normName(s: string | null | undefined): string {
  if (!s) return "";
  let out = s.toLowerCase();
  out = out.replace(/[^a-z0-9\s]/g, " ");
  out = out.replace(/\s+/g, " ").trim();
  return out;
}

export function nameTokens(s: string | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const t of normName(s).split(" ")) {
    if (t && !STOPWORDS.has(t)) out.add(t);
  }
  return out;
}

function slugToName(slug: string | null | undefined): string {
  return slug ? normName(slug.replace(/-/g, " ")) : "";
}

/** Jaccard-style token overlap (|A∩B| / |A∪B|). */
function tokenOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * difflib.SequenceMatcher.ratio() equivalent (Ratcliff/Obershelp). Used as the
 * full-string similarity component in GPMG↔statewide matching, mirroring
 * retriever.py. Fuse.js is used for the user-facing fuzzy_property lookup in
 * retriever.ts; this internal merge ratio stays faithful to the Python tool.
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

// --------------------------------------------------------------------------- //
// Types
// --------------------------------------------------------------------------- //
export interface Availability {
  status: "statewide_only" | "available_now";
  availableUnitsCount: number | null;
  asOf: string | null;
}

export interface NormalizedProperty {
  id: string;
  name: string | null;
  city: string | null;
  address: string | null;
  type: string | null;
  totalUnits: number | null;
  restrictedUnits: number | null;
  amiTiers: string[] | null;
  funding: string[] | null;
  availability: Availability;
  rent: { disclosed: boolean; text: string | null };
  contact: {
    phone: string | null;
    email: string | null;
    officeHours: string | null;
    waitlistUrl: string | null;
    applicationUrl: string | null;
  };
  amenities: string[] | null;
  accessibility: string | null;
  petPolicy: string | null;
  unitTypes: string[] | null;
  _source: { base: string; availability: string | null };
  // internal-only (stripped before injection)
  _lat: number | null;
  _lng: number | null;
  _aka: string;
}

interface StatewideRaw {
  name?: string;
  aka?: string;
  city?: string;
  address?: string;
  lat?: number;
  lng?: number;
  totalUnits?: number;
  restrictedUnits?: number;
  type?: string;
  amiTiers?: string[];
  funding?: string[];
}

interface GpmgRaw {
  slug?: string;
  name?: string;
  address?: { line1?: string; city?: string; state?: string; zip?: string };
  phone?: string;
  email?: string;
  manager_email?: string;
  property_type?: string;
  amenities?: string[];
  accessibility?: string[] | string;
  pet_policy?: string | null;
  office_hours?: string;
  unit_types?: string[];
  rent_disclosed?: boolean;
  rent_text?: string | null;
  available_units_count?: number | null;
  waitlist_url?: string | null;
  application_url?: string | null;
}

// --------------------------------------------------------------------------- //
// Data loading
// --------------------------------------------------------------------------- //
function loadStatewide(): { raw: StatewideRaw[]; path: string } {
  const p = fs.existsSync(STATEWIDE_PRIMARY)
    ? STATEWIDE_PRIMARY
    : STATEWIDE_FALLBACK;
  const parsed = JSON.parse(fs.readFileSync(p, "utf8"));
  const arr: StatewideRaw[] = Array.isArray(parsed)
    ? parsed
    : parsed.properties || parsed.records || [];
  return { raw: arr, path: p };
}

function loadGpmg(): { raw: GpmgRaw[]; snapshot: string | null } {
  if (!fs.existsSync(GPMG_PATH)) return { raw: [], snapshot: null };
  const d = JSON.parse(fs.readFileSync(GPMG_PATH, "utf8"));
  const props: GpmgRaw[] = Array.isArray(d) ? d : d.properties || [];
  const snapshot: string | null = Array.isArray(d)
    ? null
    : d.source_snapshot || null;
  return { raw: props, snapshot };
}

// --------------------------------------------------------------------------- //
// Normalized record construction (LOCKED contract shape)
// --------------------------------------------------------------------------- //
function blankNormalized(rec: StatewideRaw): NormalizedProperty {
  return {
    id: normName(rec.name || "").replace(/ /g, "-") || "unknown",
    name: rec.name || null,
    city: rec.city || null,
    address: rec.address || null,
    type: rec.type || null,
    totalUnits: rec.totalUnits ?? null,
    restrictedUnits: rec.restrictedUnits ?? null,
    amiTiers: rec.amiTiers && rec.amiTiers.length ? rec.amiTiers : null,
    funding: rec.funding && rec.funding.length ? rec.funding : null,
    availability: {
      status: "statewide_only",
      availableUnitsCount: null,
      asOf: null,
    },
    rent: { disclosed: false, text: null },
    contact: {
      phone: null,
      email: null,
      officeHours: null,
      waitlistUrl: null,
      applicationUrl: null,
    },
    amenities: null,
    accessibility: null,
    petPolicy: null,
    unitTypes: null,
    _source: { base: "HUD-LIHTC statewide", availability: null },
    _lat: rec.lat ?? null,
    _lng: rec.lng ?? null,
    _aka: rec.aka || "",
  };
}

function normalizeAccessibility(
  acc: string[] | string | undefined
): string | null {
  if (Array.isArray(acc)) return acc.length ? acc.join("; ") : null;
  return acc || null;
}

function gpmgToNormalized(
  g: GpmgRaw,
  snapshot: string | null
): NormalizedProperty {
  const addr = g.address || {};
  const parts = [addr.line1, addr.city, addr.state, addr.zip].filter(Boolean);
  const address = parts.length ? parts.join(", ") : null;
  return {
    id: g.slug || normName(g.name || "").replace(/ /g, "-"),
    name: g.name || null,
    city: addr.city || null,
    address,
    type: g.property_type || null,
    totalUnits: null,
    restrictedUnits: null,
    amiTiers: null,
    funding: null,
    availability: {
      status: "available_now",
      availableUnitsCount: g.available_units_count ?? null,
      asOf: snapshot,
    },
    rent: { disclosed: Boolean(g.rent_disclosed), text: g.rent_text ?? null },
    contact: {
      phone: g.phone ?? null,
      email: g.email || g.manager_email || null,
      officeHours: g.office_hours ?? null,
      waitlistUrl: g.waitlist_url ?? null,
      applicationUrl: g.application_url ?? null,
    },
    amenities: g.amenities && g.amenities.length ? g.amenities : null,
    accessibility: normalizeAccessibility(g.accessibility),
    petPolicy: g.pet_policy ?? null,
    unitTypes: g.unit_types && g.unit_types.length ? g.unit_types : null,
    _source: {
      base: "HUD-LIHTC statewide",
      availability: snapshot ? `GPMG ${snapshot}` : "GPMG",
    },
    _lat: null,
    _lng: null,
    _aka: "",
  };
}

function enrichWithGpmg(
  norm: NormalizedProperty,
  g: GpmgRaw,
  snapshot: string | null
): void {
  norm.availability = {
    status: "available_now",
    availableUnitsCount: g.available_units_count ?? null,
    asOf: snapshot,
  };
  norm.rent = { disclosed: Boolean(g.rent_disclosed), text: g.rent_text ?? null };
  norm.contact = {
    phone: g.phone ?? null,
    email: g.email || g.manager_email || null,
    officeHours: g.office_hours ?? null,
    waitlistUrl: g.waitlist_url ?? null,
    applicationUrl: g.application_url ?? null,
  };
  norm.amenities = g.amenities && g.amenities.length ? g.amenities : null;
  norm.accessibility = normalizeAccessibility(g.accessibility);
  norm.petPolicy = g.pet_policy ?? null;
  norm.unitTypes = g.unit_types && g.unit_types.length ? g.unit_types : null;
  if (!norm.type) norm.type = g.property_type || null;
  norm._source.availability = snapshot ? `GPMG ${snapshot}` : "GPMG";
}

/**
 * Match a GPMG record to a statewide normalized record. Strategy: token overlap
 * on significant name tokens; full-string ratio fallback; penalize cross-city
 * collisions. Returns the best statewide norm or null. Mirrors
 * retriever._match_gpmg_to_statewide.
 */
function matchGpmgToStatewide(
  g: GpmgRaw,
  statewide: NormalizedProperty[]
): NormalizedProperty | null {
  const gName = g.name || slugToName(g.slug);
  const gTokens = nameTokens(gName);
  const gFull = normName(gName);
  const addr = g.address || {};
  const gCity = normName(addr.city || "");

  let best: NormalizedProperty | null = null;
  let bestScore = 0;
  for (const s of statewide) {
    const sName = s.name || "";
    const sTokens = new Set<string>([
      ...nameTokens(sName),
      ...nameTokens(s._aka),
    ]);
    let score: number;
    if (gTokens.size === 0 || sTokens.size === 0) {
      score = seqRatio(gFull, normName(sName));
    } else {
      const overlap = tokenOverlap(gTokens, sTokens);
      const ratio = seqRatio(gFull, normName(sName));
      score = 0.7 * overlap + 0.3 * ratio;
    }
    if (gCity && s.city && normName(s.city) !== gCity) {
      score *= 0.5;
    }
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  if (best !== null && bestScore >= 0.45) return best;
  return null;
}

// --------------------------------------------------------------------------- //
// Index
// --------------------------------------------------------------------------- //
export interface HousingIndex {
  records: NormalizedProperty[];
  statewidePath: string;
  gpmgSnapshot: string | null;
  statewideCount: number;
  gpmgCount: number;
  availableNowCount: number;
  allCities(): string[];
  byCity(city: string): NormalizedProperty[];
}

function buildIndex(): HousingIndex {
  const { raw: statewideRaw, path: statewidePath } = loadStatewide();
  const { raw: gpmgRaw, snapshot } = loadGpmg();

  const records: NormalizedProperty[] = statewideRaw.map(blankNormalized);

  const matched = new Set<NormalizedProperty>();
  for (const g of gpmgRaw) {
    const target = matchGpmgToStatewide(g, records);
    if (target !== null && !matched.has(target)) {
      enrichWithGpmg(target, g, snapshot);
      matched.add(target);
    } else {
      records.push(gpmgToNormalized(g, snapshot));
    }
  }

  const availableNowCount = records.filter(
    (r) => r.availability.status === "available_now"
  ).length;

  let citiesCache: string[] | null = null;

  return {
    records,
    statewidePath,
    gpmgSnapshot: snapshot,
    statewideCount: statewideRaw.length,
    gpmgCount: gpmgRaw.length,
    availableNowCount,
    allCities(): string[] {
      if (citiesCache) return citiesCache;
      const set = new Set<string>();
      for (const r of records) if (r.city) set.add(r.city);
      citiesCache = Array.from(set).sort();
      return citiesCache;
    },
    byCity(city: string): NormalizedProperty[] {
      const c = normName(city);
      return records.filter((r) => normName(r.city) === c);
    },
  };
}

// Module-scope singleton — build once.
let indexSingleton: HousingIndex | null = null;

export function getHousingIndex(): HousingIndex {
  if (indexSingleton === null) {
    indexSingleton = buildIndex();
  }
  return indexSingleton;
}

/** Test-only: force a rebuild on next getHousingIndex(). */
export function _resetIndex(): void {
  indexSingleton = null;
}
