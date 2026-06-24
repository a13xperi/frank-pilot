import { query } from "../../config/database";
import { logger } from "../../utils/logger";
import {
  registerToolHandler,
  type ToolCallbackContext,
  type ToolCallbackResult,
} from "./tool-callbacks";

/**
 * Voice tool: `get_property_details` — answer "where is it / what amenities does
 * it have / is it senior / pet-friendly / accessible?" for FREE, instantly, on
 * the call. Kills the "I don't have the exact street address" deflection.
 *
 * Looks a property up by name (fuzzy — Frank says "Donna Louise" or "Ethel Mae
 * Robinson"). Returns the full street address, the senior/family designation,
 * amenities, pet policy, and accessibility — all already on the properties row
 * (amenities backfilled from the GPM extract).
 *
 * Returns:
 *   { ok:true,  result:{ name, address, type, amenities, pet_policy, accessibility }, message }
 *   { ok:false, message }   // no name, or no match
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

  // Fuzzy name match: tolerate "Donna Louise" → "Donna Louise Apartments".
  const res = await query(
    `SELECT name, address_line1, address_line2, city, state, zip,
            property_type, amenities, pet_policy, accessibility
       FROM properties
      WHERE name ILIKE '%' || $1 || '%'
      ORDER BY length(name) ASC
      LIMIT 1`,
    [name]
  );
  if (res.rows.length === 0) {
    logger.info("get_property_details no match", { conversationId: context.conversationId });
    return {
      ok: false,
      message: `I couldn't find a property called ${name}. Let me read you the open options and you can pick one.`,
    };
  }

  const r = res.rows[0];
  const street = [r.address_line1, r.address_line2].filter(Boolean).join(", ");
  const cityState = [r.city, r.state].filter(Boolean).join(", ");
  // "1327 H Street, Las Vegas, NV 89106" — comma between street/city/state, space before zip.
  const cityStateZip = [cityState, r.zip].filter(Boolean).join(" ");
  const fullAddress = [street, cityStateZip].filter(Boolean).join(", ").trim();
  const typeLabel = TYPE_LABEL[r.property_type as string] ?? "a community";
  const amenities = Array.isArray(r.amenities) ? (r.amenities as string[]) : [];
  const accessibility = Array.isArray(r.accessibility) ? (r.accessibility as string[]) : [];

  logger.info("get_property_details", {
    conversationId: context.conversationId,
    property: r.name,
    amenityCount: amenities.length,
  });

  // Spoken summary Frank can read directly.
  const parts: string[] = [`${r.name} is ${typeLabel}`];
  if (fullAddress) parts.push(`located at ${fullAddress}`);
  if (amenities.length) parts.push(`Amenities include ${amenities.slice(0, 5).join(", ")}`);
  if (r.pet_policy) parts.push(`Pet policy: ${r.pet_policy}`);
  const message = parts.join(". ") + ".";

  return {
    ok: true,
    result: {
      name: r.name as string,
      address: fullAddress || null,
      type: r.property_type as string,
      is_senior: r.property_type === "senior",
      amenities,
      pet_policy: (r.pet_policy as string) ?? null,
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

let registered = false;
export function registerGetPropertyDetailsHandler(): void {
  if (registered) return;
  registerToolHandler("get_property_details", getPropertyDetailsHandler);
  registered = true;
}

export function __resetRegistrationForTests(): void {
  registered = false;
}
