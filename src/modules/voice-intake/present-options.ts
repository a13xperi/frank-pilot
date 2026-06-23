import { query } from "../../config/database";
import { logger } from "../../utils/logger";
import { registerPrequalifyHandler } from "./prequalify";
import {
  registerToolHandler,
  type ToolCallbackContext,
  type ToolCallbackResult,
} from "./tool-callbacks";

/**
 * Funnel voice tool: `present_options`.
 *
 * After `prequalify` tells the caller which AMI tier they land in, Frank fires
 * this to read back a few concrete, currently-open homes they'd qualify for —
 * PORTFOLIO-WIDE, across every property (not the single property the wizard's
 * authed GET /units would scope to). "Here's what's open for you: a 2-bedroom
 * at Maple Court for $1,425…"
 *
 * The matching SQL is the SAME selection logic as
 * `src/modules/applicants/routes.ts` GET /units (~line 1078): a unit counts as
 * open when it's `available` OR a stale `held` (claim_expires_at < NOW(), so no
 * cron is required); the property's `ami_set_aside` must be at/above the
 * caller's tier (or market-rate, i.e. null/empty); optional bedrooms and a rent
 * ceiling narrow further; results are ordered by rent ascending. Kept verbatim
 * so the homes Frank names match exactly what the caller sees in the app.
 *
 * Difference from GET /units: that route is authenticated + email-verified and
 * limited to LIMIT 12; here there is no user yet (pre-account voice prospect),
 * so we run the same WHERE/ORDER but trim to a phone-friendly top ~6.
 *
 * Returns ToolCallbackResult:
 *   - { ok: true,  result: { options: [{ property, unit_type, rent, ... }] },
 *                  message } → agent reads back the first couple
 *   - { ok: false, message } when we can't run the search (bad tier)
 *
 * Mirrors send-app-link.ts exactly:
 *   - same handler signature (parameters, context) => ToolCallbackResult
 *   - one-time idempotent registration helper
 *
 * Tape stamp: the parent dispatcher already emits VOICE_TOOL_INVOKED. We do
 * NOT double-stamp.
 */

// Tiers most- to least-restrictive — the same order GET /units walks so the
// set-aside union is identical. A '50' applicant sees ['50','60','80']% homes.
const AMI_TIER_ORDER = ["30", "50", "60", "80"] as const;
type AmiTier = (typeof AMI_TIER_ORDER)[number];

// Phone-friendly slice — the agent reads back the first couple, never a wall
// of twelve over voice.
const MAX_OPTIONS = 6;

export async function presentOptionsHandler(
  parameters: Record<string, unknown>,
  context: ToolCallbackContext
): Promise<ToolCallbackResult> {
  const amiTier = pickAmiTier(parameters, "ami_tier");
  const bedrooms = pickNumber(parameters, "bedrooms");
  const maxRent = pickNumber(parameters, "max_rent");

  if (!amiTier) {
    logger.warn("present_options missing/invalid ami_tier", {
      conversationId: context.conversationId,
      rawTier: typeof parameters.ami_tier === "string" ? parameters.ami_tier : null,
    });
    return {
      ok: false,
      message:
        "Let me check what you qualify for first, then I can pull up what's open.",
    };
  }

  // ── Reused verbatim from routes.ts GET /units (~line 1078) ──────────────
  // A unit is open when available, or held-but-stale (so no cron is needed).
  const conditions: string[] = [
    "(u.status = 'available' OR (u.status = 'held' AND u.claim_expires_at < NOW()))",
  ];
  const params: unknown[] = [];

  if (bedrooms !== undefined && bedrooms !== null && Number.isFinite(bedrooms)) {
    params.push(bedrooms);
    conditions.push(`u.bedrooms = $${params.length}`);
  }
  if (maxRent !== undefined && maxRent !== null && Number.isFinite(maxRent)) {
    params.push(maxRent);
    conditions.push(`u.monthly_rent <= $${params.length}`);
  }

  // Match the property's set-aside text ("60% AMI", "80% AMI", …) to the tiers
  // at or above the applicant's lowest qualifying tier. Market-rate properties
  // (null/empty set_aside) stay visible.
  const idx = AMI_TIER_ORDER.indexOf(amiTier);
  const allowedSetAsides = AMI_TIER_ORDER.slice(idx).map((t) => `${t}% AMI`);
  params.push(allowedSetAsides);
  conditions.push(
    `(p.ami_set_aside = ANY($${params.length}) OR p.ami_set_aside IS NULL OR p.ami_set_aside = '')`
  );

  // Same SELECT/JOIN/ORDER as GET /units; trimmed to a voice-friendly top N.
  params.push(MAX_OPTIONS);
  const result = await query(
    `SELECT u.id, u.property_id, u.unit_number, u.bedrooms, u.bathrooms,
            u.sqft, u.monthly_rent, u.photo_url, u.available_from,
            p.name AS property_name, p.city AS property_city, p.state AS property_state
       FROM units u
       JOIN properties p ON p.id = u.property_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY u.monthly_rent ASC, u.unit_number ASC
      LIMIT $${params.length}`,
    params
  );
  // ────────────────────────────────────────────────────────────────────────

  const options = result.rows.map((row) => ({
    unit_id: row.id as string,
    property: row.property_name as string | null,
    property_city: row.property_city as string | null,
    property_state: row.property_state as string | null,
    unit_number: row.unit_number as string | null,
    bedrooms: row.bedrooms as number | null,
    unit_type: bedroomLabel(row.bedrooms as number | null),
    bathrooms: row.bathrooms as number | null,
    sqft: row.sqft as number | null,
    rent: row.monthly_rent as number | null,
    available_from: row.available_from as string | null,
    photo_url: row.photo_url as string | null,
  }));

  logger.info("present_options served", {
    conversationId: context.conversationId,
    amiTier,
    bedrooms: bedrooms ?? null,
    count: options.length,
  });

  if (options.length === 0) {
    return {
      ok: true,
      result: { options: [] },
      message:
        "I don't have anything open that matches right this second, but new homes free up often. Want me to text you a link so you're first to know?",
    };
  }

  return {
    ok: true,
    result: { options },
    message: `Here's what's open for you: ${spokenOptions(options)}.`,
  };
}

/** Validate the caller's tier against the legal set; null if not a real tier. */
function pickAmiTier(parameters: Record<string, unknown>, key: string): AmiTier | null {
  const value = parameters[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return (AMI_TIER_ORDER as readonly string[]).includes(trimmed)
    ? (trimmed as AmiTier)
    : null;
}

/**
 * Coerce a tool parameter to a finite number. ElevenLabs may send a numeric
 * field as a JSON number or a spoken-then-stringified value ("$1,425"), so we
 * strip currency/grouping punctuation before parsing. Returns null if absent.
 */
function pickNumber(parameters: Record<string, unknown>, key: string): number | null {
  const value = parameters[key];
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.]/g, "");
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** "studio" / "1-bedroom" / "2-bedroom" label for read-back. */
function bedroomLabel(bedrooms: number | null): string {
  if (bedrooms == null || !Number.isFinite(bedrooms)) return "home";
  if (bedrooms <= 0) return "studio";
  return `${bedrooms}-bedroom`;
}

/**
 * Compose the first couple of options into a natural spoken phrase:
 * "a 2-bedroom at Maple Court for $1,425, and a 1-bedroom at Oak Place for
 * $1,187". We read back at most the top 2 so Frank stays conversational; the
 * full list rides in result.options for the app/handoff.
 */
function spokenOptions(
  options: Array<{
    unit_type: string;
    property: string | null;
    rent: number | null;
  }>
): string {
  const phrases = options.slice(0, 2).map((o) => {
    const where = o.property ? ` at ${o.property}` : "";
    const price = o.rent != null ? ` for $${o.rent.toLocaleString("en-US")}` : "";
    return `a ${o.unit_type}${where}${price}`;
  });
  if (phrases.length === 1) return phrases[0];
  const more = options.length > 2 ? `, and ${options.length - 2} more` : "";
  return `${phrases[0]}, and ${phrases[1]}${more}`;
}

let registered = false;
/**
 * Idempotent registration helper. Boot calls this once (via
 * registerFunnelToolHandlers); tests can also call it after
 * clearToolHandlersForTests() to re-wire.
 */
export function registerPresentOptionsHandler(): void {
  if (registered) return;
  registerToolHandler("present_options", presentOptionsHandler);
  registered = true;
}

/** Test-only: reset the one-time gate so jest can re-register fresh. */
export function __resetRegistrationForTests(): void {
  registered = false;
}

/**
 * Register BOTH funnel voice tools (prequalify + present_options) in one call.
 * `index.ts` (the integrate step wires it) should call this at boot, alongside
 * registerVoiceToolHandlers() / registerNameVerificationHandler(). Kept here so
 * the funnel slice owns its own registration surface.
 */
export function registerFunnelToolHandlers(): void {
  registerPrequalifyHandler();
  registerPresentOptionsHandler();
}
