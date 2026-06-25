import { query } from "../../config/database";
import { logger } from "../../utils/logger";
import {
  registerToolHandler,
  type ToolCallbackContext,
  type ToolCallbackResult,
} from "./tool-callbacks";

/**
 * Voice tool: `recommend_by_need` — context-aware matching. When a caller
 * signals a NEED ("I'm sixty-seven", "it's for my mother", "a quiet senior
 * community", or conversely "I have three kids"), recommend the right KIND of
 * community — senior (age-restricted) vs family — instead of whatever's open.
 *
 * Filters open units by the property's `property_type` (senior when the caller
 * signals senior, family/mixed otherwise) plus optional bedrooms + budget, and
 * returns the top few with address + rent so Frank can steer them right.
 *
 * Returns:
 *   { ok:true, result:{ recommended_type, options:[...] }, message }
 *   { ok:true, result:{ options:[] }, message }   // nothing open that matches
 */

const MAX = 5;

export async function recommendByNeedHandler(
  parameters: Record<string, unknown>,
  context: ToolCallbackContext
): Promise<ToolCallbackResult> {
  const senior = pickBool(parameters, "age_55_plus") || pickBool(parameters, "senior");
  const bedrooms = pickNumber(parameters, "bedrooms");
  const budgetMax = pickNumber(parameters, "budget_max");

  const conditions: string[] = [
    "(u.status = 'available' OR (u.status = 'held' AND u.claim_expires_at < NOW()))",
  ];
  const params: unknown[] = [];

  // The need: senior callers → senior communities; everyone else → family/mixed.
  if (senior) {
    conditions.push("p.property_type = 'senior'");
  } else {
    conditions.push("(p.property_type = 'family' OR p.property_type = 'mixed_use')");
  }
  if (bedrooms !== null && Number.isFinite(bedrooms)) {
    params.push(bedrooms);
    conditions.push(`u.bedrooms = $${params.length}`);
  }
  if (budgetMax !== null && Number.isFinite(budgetMax)) {
    params.push(budgetMax);
    conditions.push(`u.monthly_rent <= $${params.length}`);
  }
  params.push(MAX);

  const res = await query(
    `SELECT u.id, u.unit_number, u.bedrooms, u.monthly_rent, u.available_from,
            p.name AS property_name, p.property_type,
            p.address_line1 AS property_address, p.city AS property_city
       FROM units u
       JOIN properties p ON p.id = u.property_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY u.monthly_rent ASC, u.unit_number ASC
      LIMIT $${params.length}`,
    params
  );

  const options = res.rows.map((r) => ({
    unit_id: r.id as string,
    property: r.property_name as string | null,
    property_address: r.property_address as string | null,
    property_city: r.property_city as string | null,
    type: r.property_type as string,
    is_senior: r.property_type === "senior",
    bedrooms: r.bedrooms as number | null,
    rent: r.monthly_rent as number | null,
    available_from: r.available_from as string | null,
  }));

  const kind = senior ? "senior" : "family";
  logger.info("recommend_by_need", {
    conversationId: context.conversationId,
    recommendedType: kind,
    count: options.length,
  });

  if (options.length === 0) {
    return {
      ok: true,
      result: { recommended_type: kind, options: [] },
      message: senior
        ? "I don't have a senior community with something open that matches right now, but they free up often. Want me to take your info so you're first to know?"
        : "I don't have a match open right this second, but new homes free up often. Want me to take your info so you're first to know?",
    };
  }

  const spoken = options
    .slice(0, 3)
    .map((o) => `${o.property} at ${o.rent ? "$" + o.rent : "a great rate"}`)
    .join(", ");
  const lead = senior
    ? `Since you're looking for a senior community, here's what's open: ${spoken}.`
    : `Here's what's open for your household: ${spoken}.`;

  return {
    ok: true,
    result: { recommended_type: kind, options },
    message: lead,
  };
}

function pickNumber(parameters: Record<string, unknown>, key: string): number | null {
  const v = parameters[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  return null;
}
function pickBool(parameters: Record<string, unknown>, key: string): boolean {
  const v = parameters[key];
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.trim().toLowerCase() === "true";
  return false;
}

let registered = false;
export function registerRecommendByNeedHandler(): void {
  if (registered) return;
  registerToolHandler("recommend_by_need", recommendByNeedHandler);
  registered = true;
}

export function __resetRegistrationForTests(): void {
  registered = false;
}
