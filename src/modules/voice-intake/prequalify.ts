import { logger } from "../../utils/logger";
import {
  qualifyAmiTier,
  incomeLimit,
  maxRent,
  countyForMsa,
  BEDROOM_KEYS,
  type MsaKey,
  type BedroomKey,
  type AmiTier,
} from "../applicants/ami-qualify";
import {
  registerToolHandler,
  type ToolCallbackContext,
  type ToolCallbackResult,
} from "./tool-callbacks";

/**
 * Funnel voice tool: `prequalify`.
 *
 * Early in the call, once the caller volunteers household size and rough
 * yearly income, Frank fires this to give them an instant, encouraging read:
 * "based on that, you look eligible and could rent up to about $X." We run the
 * SAME backend AMI authority the wizard uses (`ami-qualify`:
 * qualifyAmiTier/incomeLimit/maxRent) so the number the caller hears matches
 * what they'll see in the app — there is no second, drifting copy of the math.
 *
 * SOFT SELF-REPORTED PRE-SCREEN — NOT a binding approve/deny. The figures are
 * whatever the caller said over the phone (un-verified, un-documented). The
 * tool always frames the result as "you look eligible / here's roughly what
 * you'd qualify for," never "approved" or "denied." Actual eligibility is the
 * documented application + the leasing team's review; this is only the friendly
 * nudge that keeps a qualified caller on the line.
 *
 * Coverage today is Clark County / Las Vegas MSA (the only county ingested in
 * `ami-qualify`), so `current_city` is captured for logging/colour but the math
 * is pinned to LAS_VEGAS_HENDERSON until more MSAs are added.
 *
 * Returns ToolCallbackResult:
 *   - { ok: true,  result: { ami_tier, income_limit, max_rent_by_bedroom,
 *                            qualifies }, message } → agent reads it back
 *   - { ok: false, message } when we can't run the screen (missing numbers)
 *
 * Mirrors send-app-link.ts exactly:
 *   - same handler signature (parameters, context) => ToolCallbackResult
 *   - one-time idempotent registration helper
 *   - masked-input logging (we never log the raw income, only coarse signal)
 *
 * Tape stamp: the parent dispatcher already emits VOICE_TOOL_INVOKED with the
 * ok/handler outcome. We do NOT double-stamp.
 */

// Single MSA ingested today; the math is pinned here until more counties land.
const DEFAULT_MSA: MsaKey = "LAS_VEGAS_HENDERSON";

export async function prequalifyHandler(
  parameters: Record<string, unknown>,
  context: ToolCallbackContext
): Promise<ToolCallbackResult> {
  const householdSize = pickNumber(parameters, "household_size");
  const grossAnnualIncome = pickNumber(parameters, "gross_annual_income");
  const currentCity = pickString(parameters, "current_city");

  if (householdSize == null || householdSize < 1) {
    logger.warn("prequalify missing household_size", {
      conversationId: context.conversationId,
    });
    return {
      ok: false,
      message:
        "I didn't catch how many people would be living with you. How many are in the household?",
    };
  }
  if (grossAnnualIncome == null || grossAnnualIncome < 0) {
    logger.warn("prequalify missing gross_annual_income", {
      conversationId: context.conversationId,
    });
    return {
      ok: false,
      message:
        "I didn't catch your yearly income. Roughly how much does the household bring in before taxes each year?",
    };
  }

  // Backend AMI authority — the same lib the wizard's /qualify endpoint uses.
  const amiTier = qualifyAmiTier(DEFAULT_MSA, householdSize, grossAnnualIncome);
  const county = countyForMsa(DEFAULT_MSA);
  if (county == null) {
    // Unreachable while the MSA map has one member, but keep the contract
    // honest if a future MSA is added before its dataset.
    logger.error("prequalify unknown MSA", {
      conversationId: context.conversationId,
      msa: DEFAULT_MSA,
    });
    return {
      ok: false,
      message:
        "Sorry, I can't size that up for your area right now. The leasing team can walk you through it.",
    };
  }

  logger.info("prequalify computed", {
    conversationId: context.conversationId,
    householdSize,
    // Never log the raw income — only the coarse outcome signal.
    incomeBand: maskIncome(grossAnnualIncome),
    amiTier: amiTier ?? "over-income",
    city: currentCity ?? null,
  });

  // Over-income for every affordable tier: still a soft, non-binding result.
  // Surface a friendly "looks like you're over the limit" rather than a hard
  // denial — the caller may have mis-stated income, and final eligibility is
  // always the documented application + leasing review.
  if (amiTier == null) {
    const emptyRents = emptyRentByBedroom();
    return {
      ok: true,
      result: {
        ami_tier: null,
        income_limit: null,
        max_rent_by_bedroom: emptyRents,
        qualifies: false,
      },
      message:
        "Based on what you shared, the income looks like it's above the limit for these set-aside homes — but that's just a quick estimate, not a decision. The leasing team can confirm and point you to other options.",
    };
  }

  const max_rent_by_bedroom = maxRentByBedroom(county, amiTier);
  const income_limit = incomeLimit(county, amiTier, householdSize);

  // Friendliest single number to read back: the largest published cap across
  // bedroom types for the qualifying tier (what they could rent "up to").
  const topRent = topCap(max_rent_by_bedroom);

  return {
    ok: true,
    result: {
      ami_tier: amiTier,
      income_limit,
      max_rent_by_bedroom,
      qualifies: true,
    },
    message:
      topRent != null
        ? `Based on that, you qualify for rent up to about $${topRent.toLocaleString("en-US")} — you look eligible.`
        : "Based on that, you look eligible. The leasing team can confirm the exact rent ranges for your household.",
  };
}

function pickString(parameters: Record<string, unknown>, key: string): string | null {
  const value = parameters[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * Coerce a tool parameter to a finite number. ElevenLabs may send a numeric
 * field as a JSON number or as a spoken-then-stringified value ("52,750",
 * "$52750/yr"), so we strip currency/grouping punctuation before parsing.
 * Returns null if there's no parseable number.
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

/**
 * Coarse income band for log lines. We never log the caller's exact
 * self-reported income — only a wide bucket, enough to debug "why did this
 * caller get tier X" without persisting a precise PII figure to logs.
 */
function maskIncome(income: number): string {
  if (income < 25_000) return "<25k";
  if (income < 50_000) return "25-50k";
  if (income < 75_000) return "50-75k";
  if (income < 100_000) return "75-100k";
  return "100k+";
}

/** Rent ceilings by bedroom for a qualifying tier (null where unpublished). */
function maxRentByBedroom(
  county: NonNullable<ReturnType<typeof countyForMsa>>,
  tier: AmiTier
): Record<BedroomKey, number | null> {
  const out = emptyRentByBedroom();
  for (const bedroom of BEDROOM_KEYS) {
    out[bedroom] = maxRent(county, tier, bedroom);
  }
  return out;
}

function emptyRentByBedroom(): Record<BedroomKey, number | null> {
  const out = {} as Record<BedroomKey, number | null>;
  for (const bedroom of BEDROOM_KEYS) out[bedroom] = null;
  return out;
}

/** Largest published rent cap across bedroom types, or null if none. */
function topCap(byBedroom: Record<BedroomKey, number | null>): number | null {
  let top: number | null = null;
  for (const bedroom of BEDROOM_KEYS) {
    const v = byBedroom[bedroom];
    if (v != null && (top == null || v > top)) top = v;
  }
  return top;
}

let registered = false;
/**
 * Idempotent registration helper. Boot calls this once (via
 * registerFunnelToolHandlers); tests can also call it after
 * clearToolHandlersForTests() to re-wire.
 */
export function registerPrequalifyHandler(): void {
  if (registered) return;
  registerToolHandler("prequalify", prequalifyHandler);
  registered = true;
}

/** Test-only: reset the one-time gate so jest can re-register fresh. */
export function __resetRegistrationForTests(): void {
  registered = false;
}
