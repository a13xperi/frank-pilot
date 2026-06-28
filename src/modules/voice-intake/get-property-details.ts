import { logger } from "../../utils/logger";
import {
  registerToolHandler,
  type ToolCallbackContext,
  type ToolCallbackResult,
} from "./tool-callbacks";
import {
  getGpmgProperties,
  normName,
  nameTokens,
  seqRatio,
  type NormalizedProperty,
} from "../housing-qa/data";

/**
 * Voice tool: `get_property_details` — answer "where is it / what amenities does
 * it have / is it senior / pet-friendly / accessible?" for FREE, instantly, on
 * the call. Kills the "I don't have the exact street address" deflection.
 *
 * SOURCE OF TRUTH: the GPM property corpus (docs/intel/gpmglv-properties-extracted.json,
 * loaded via the housing-qa index), NOT the operational `properties` DB table.
 * Amenities, address, senior/family designation, pet policy, and accessibility
 * are marketing facts scraped from the live gpmglv.com pages — they live in the
 * corpus. The DB table holds operational rows (units/rent/ledger) and its
 * amenities column was never backfilled (it returned `amenities: []`), and its
 * names drift from what Frank says ("Donna Louise Apartments 2" vs the caller's
 * "Donna Louise 2"), so the old DB ILIKE lookup also failed to resolve the two
 * family communities. Sourcing from the corpus fixes amenities, addresses, and
 * name matching together. Availability ("what's open") stays a DB concern and is
 * owned by present_options / recommend_by_need.
 *
 * Fuzzy name match (corpus): Frank says "Donna Louise 2" or "David J Hoggard"
 * and we resolve it to the canonical community via fuzzyProperty (the same
 * matcher the tenant chat uses — token overlap + containment + Fuse). Matches
 * are scoped to GPM available-now communities so Frank never reads amenity-less
 * statewide records off-scope.
 *
 * Returns:
 *   { ok:true,  result:{ name, address, type, is_senior, amenities, pet_policy, accessibility }, message }
 *   { ok:false, message }   // no name, or no GPM match
 */

const TYPE_LABEL: Record<string, string> = {
  senior: "a senior (age-restricted) community",
  family: "a family community",
  mixed_use: "a mixed-use community",
};

export async function getPropertyDetailsHandler(
  parameters: Record<string, unknown>,
  context: ToolCallbackContext
): Promise<ToolCallbackResult> {
  const name = pickString(parameters, "property_name") ?? pickString(parameters, "property");
  if (!name) {
    return { ok: false, message: "Which property would you like the details for?" };
  }

  // Resolve against the GPM corpus only (canonical names + slugs, lowercase
  // types). Tolerates "Donna Louise 2" → "Donna Louise 2 Apartments" and
  // "David J Hoggard" → "David J. Hoggard …".
  const [rec, score] = matchGpmProperty(name);
  if (!rec) {
    logger.info("get_property_details no match", {
      conversationId: context.conversationId,
      query: name,
      score,
    });
    return {
      ok: false,
      message: `I couldn't find a property called ${name}. Let me read you the open options and you can pick one.`,
    };
  }

  const fullAddress = rec.address ?? null;
  const typeLabel = TYPE_LABEL[rec.type ?? ""] ?? "a community";
  const amenities = rec.amenities ?? [];
  // NormalizedProperty stores accessibility as a "; "-joined string; the tool
  // contract returns an array, so split it back.
  const accessibility = rec.accessibility
    ? rec.accessibility.split(";").map((s) => s.trim()).filter(Boolean)
    : [];
  const petPolicy = rec.petPolicy ?? null;

  logger.info("get_property_details", {
    conversationId: context.conversationId,
    property: rec.name,
    amenityCount: amenities.length,
    score,
  });

  // Spoken summary Frank can read directly.
  const parts: string[] = [`${rec.name} is ${typeLabel}`];
  if (fullAddress) parts.push(`located at ${fullAddress}`);
  if (amenities.length) parts.push(`Amenities include ${amenities.slice(0, 5).join(", ")}`);
  if (petPolicy) parts.push(`Pet policy: ${petPolicy}`);
  const message = parts.join(". ") + ".";

  return {
    ok: true,
    result: {
      name: rec.name as string,
      address: fullAddress,
      type: rec.type as string,
      is_senior: rec.type === "senior",
      amenities,
      pet_policy: petPolicy,
      accessibility,
    },
    message,
  };
}

function pickString(parameters: Record<string, unknown>, key: string): string | null {
  const value = parameters[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

const MATCH_THRESHOLD = 0.6;

/**
 * Fuzzy-match a caller-spoken name to one of the GPM communities. Scored over
 * each record's display name AND its slug-as-words, blending containment, token
 * overlap, and Ratcliff/Obershelp ratio — the same primitives the housing-qa
 * retriever uses. Restricting the pool to the ~17 GPM records (not the merged
 * statewide index) avoids near-duplicate statewide names like "Ethel Mae
 * Robinson Senior II" stealing the match with zero amenities.
 */
function matchGpmProperty(query: string): [NormalizedProperty | null, number] {
  const q = normName(query);
  if (!q) return [null, 0];
  const qTokens = nameTokens(query);

  let best: NormalizedProperty | null = null;
  let bestScore = 0;
  for (const rec of getGpmgProperties()) {
    const candidates = [normName(rec.name), normName((rec.id || "").replace(/-/g, " "))];
    let local = 0;
    for (const c of candidates) {
      if (!c) continue;
      const overlap = jaccard(qTokens, nameTokens(c));
      const contains = c.includes(q) || q.includes(c) ? 1 : 0;
      const ratio = seqRatio(q, c);
      local = Math.max(local, ratio, 0.6 * overlap + 0.4 * ratio, contains * 0.95);
    }
    if (local > bestScore) {
      bestScore = local;
      best = rec;
    }
  }
  return bestScore >= MATCH_THRESHOLD ? [best, bestScore] : [null, bestScore];
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

let registered = false;
export function registerGetPropertyDetailsHandler(): void {
  if (registered) return;
  registerToolHandler("get_property_details", getPropertyDetailsHandler);
  registered = true;
}

export function __resetRegistrationForTests(): void {
  registered = false;
}
