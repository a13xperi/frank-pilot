/**
 * enrollment.ts — fail-closed chat→tier resolver for the hosted Deal-Room bot.
 *
 * Test-cut storage is an env allow-list (DEAL_QA_ALLOWLIST); the production
 * version swaps this for a Postgres table. The SECURITY CONTRACT lives in the
 * resolver, not the storage:
 *   - Unknown chat_id → NOT enrolled → the webhook refuses (stranger path).
 *   - Enrolled with a missing/invalid tier → the STRICTEST scoped tier
 *     (ext-generic), never `internal`. We deliberately do NOT port claw.py's
 *     `internal` default — that is the loosest/unscoped tier and exactly
 *     backwards on a partner surface. (The channel floor in the webhook applies
 *     on top, so even a misconfig can only over-mask.)
 *
 * Format: DEAL_QA_ALLOWLIST="<chatid>:privileged,<chatid>:ext-named"
 * A bare "<chatid>" (no tier) is enrolled but resolves to the strictest tier —
 * specify the tier explicitly for a usable compartment.
 */
import { isDealTier, type DealTier } from "./compartment-guard";

const STRICTEST: DealTier = "ext-generic";

export interface Enrollment {
  enrolled: boolean;
  tier: DealTier;
}

function parseAllowlist(raw: string): Map<string, DealTier> {
  const map = new Map<string, DealTier>();
  for (const part of (raw || "").split(",")) {
    const seg = part.trim();
    if (!seg) continue;
    const fields = seg.split(/[:\s]+/);
    const chatId = (fields[0] || "").trim();
    if (!chatId) continue;
    const tierRaw = (fields[1] || "").trim();
    // Invalid/missing tier → strictest (fail-closed), never the loosest.
    map.set(chatId, isDealTier(tierRaw) ? tierRaw : STRICTEST);
  }
  return map;
}

/**
 * Resolve a chat id to its enrollment. Parsed fresh each call (the allow-list is
 * small and env changes restart the dyno on Railway anyway), so tests can mutate
 * process.env.DEAL_QA_ALLOWLIST without a cache reset.
 */
export function resolveEnrollment(chatId: string | number): Enrollment {
  const id = String(chatId ?? "").trim();
  if (!id) return { enrolled: false, tier: STRICTEST };
  const tier = parseAllowlist(process.env.DEAL_QA_ALLOWLIST || "").get(id);
  if (tier === undefined) return { enrolled: false, tier: STRICTEST };
  return { enrolled: true, tier };
}

/** The enrolled chat ids (for an operator status read). */
export function enrolledChatIds(): string[] {
  return [...parseAllowlist(process.env.DEAL_QA_ALLOWLIST || "").keys()];
}
