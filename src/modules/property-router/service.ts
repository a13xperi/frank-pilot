import { query } from "../../config/database";
import { logger } from "../../utils/logger";

/**
 * Multi-property inbound router (Frank core C4).
 *
 * Buckets an inbound contact (call / SMS / web) to the voice agent that owns
 * the originating property. Two resolution paths:
 *   - by propertyId  — the contact already knows its property (QR/short-link,
 *     web "talk to Frank" on a property page).
 *   - by DID         — an inbound call resolves property+agent from the number
 *     it dialed (property_agent_routing.inbound_did_e164).
 *
 * The selection logic (selectRoute) is pure over the candidate rows so it's
 * exhaustively unit-testable; the DB-backed entry points just fetch candidates
 * and delegate.
 *
 * SCOPE: lookup + selection only. This never calls an agent, dials, or touches
 * the live DID/IVR config — it answers "which agent should handle this
 * contact", which the caller then uses.
 */

export type ContactChannel = "voice" | "sms" | "web";

export interface RoutingRow {
  id: string;
  property_id: string;
  agent_id: string;
  agent_label: string | null;
  inbound_did_e164: string | null;
  channels: string[];
  priority: number;
  active: boolean;
}

export interface InboundContact {
  /** Originating property, when known up front (QR/short-link/web page). */
  propertyId?: string | null;
  /** The DID the contact dialed, E.164 — used when propertyId is absent. */
  toDid?: string | null;
  /** Contact channel; used to honor per-row channel scoping. */
  channel?: ContactChannel;
}

export interface RouteDecision {
  routed: boolean;
  reason:
    | "matched"
    | "no_property"
    | "unknown_did"
    | "no_active_agent"
    | "no_channel_match";
  propertyId?: string;
  agentId?: string;
  agentLabel?: string | null;
  routingId?: string;
}

/** DID → digits only, US +1 collapsed, so "(702)…", "+1702…" and "1702…" match. */
export function normalizeDid(did: string | null | undefined): string | null {
  if (!did) return null;
  let digits = String(did).replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  return digits.length >= 7 ? digits : null;
}

/**
 * Pure selection over candidate rows for ONE property.
 *
 * - Filters to active rows that serve the requested channel (a row with empty
 *   `channels` serves all channels).
 * - Picks the lowest `priority` (primary over fallback); ties break by agent_id
 *   for determinism.
 * Returns a RouteDecision; never throws.
 */
export function selectRoute(
  rows: RoutingRow[],
  channel: ContactChannel | undefined
): RouteDecision {
  const active = rows.filter((r) => r.active);
  if (active.length === 0) {
    return { routed: false, reason: "no_active_agent" };
  }

  const channelMatched = active.filter(
    (r) => r.channels.length === 0 || (channel != null && r.channels.includes(channel))
  );
  if (channelMatched.length === 0) {
    return { routed: false, reason: "no_channel_match" };
  }

  channelMatched.sort((a, b) =>
    a.priority !== b.priority
      ? a.priority - b.priority
      : a.agent_id.localeCompare(b.agent_id)
  );
  const chosen = channelMatched[0];
  return {
    routed: true,
    reason: "matched",
    propertyId: chosen.property_id,
    agentId: chosen.agent_id,
    agentLabel: chosen.agent_label,
    routingId: chosen.id,
  };
}

/** Active routing rows for a property, best priority first. */
export async function listRoutesForProperty(propertyId: string): Promise<RoutingRow[]> {
  const result = await query(
    `SELECT id, property_id, agent_id, agent_label, inbound_did_e164,
            channels, priority, active
       FROM property_agent_routing
      WHERE property_id = $1 AND active = TRUE
      ORDER BY priority ASC, agent_id ASC`,
    [propertyId]
  );
  return result.rows as RoutingRow[];
}

/**
 * Resolve the property a DID belongs to (active mapping only). Compares on
 * digits so formatting differences don't miss. Returns null for an unknown DID.
 */
export async function resolvePropertyByDid(
  toDid: string
): Promise<{ propertyId: string } | null> {
  const digits = normalizeDid(toDid);
  if (!digits) return null;
  const result = await query(
    `SELECT property_id
       FROM property_agent_routing
      WHERE active = TRUE
        AND inbound_did_e164 IS NOT NULL
        AND regexp_replace(inbound_did_e164, '\\D', '', 'g') LIKE '%' || $1
      ORDER BY priority ASC
      LIMIT 1`,
    [digits]
  );
  const row = result.rows[0];
  return row ? { propertyId: row.property_id as string } : null;
}

/**
 * Route one inbound contact to its handling agent.
 *
 * Resolution order: explicit propertyId → DID lookup. Once a property is known,
 * selectRoute picks the agent. Every outcome is a structured RouteDecision so
 * the caller can log/branch without exceptions.
 */
export async function routeInboundContact(contact: InboundContact): Promise<RouteDecision> {
  let propertyId = contact.propertyId ?? null;

  if (!propertyId && contact.toDid) {
    const resolved = await resolvePropertyByDid(contact.toDid);
    if (!resolved) {
      logger.warn("Inbound router: unknown DID", { toDidLast4: didLast4(contact.toDid) });
      return { routed: false, reason: "unknown_did" };
    }
    propertyId = resolved.propertyId;
  }

  if (!propertyId) {
    return { routed: false, reason: "no_property" };
  }

  const rows = await listRoutesForProperty(propertyId);
  const decision = selectRoute(rows, contact.channel);
  // Ensure the propertyId is surfaced even on the no-agent paths.
  if (!decision.propertyId) decision.propertyId = propertyId;

  logger.info("Inbound contact routed", {
    propertyId,
    channel: contact.channel ?? null,
    routed: decision.routed,
    reason: decision.reason,
    agentId: decision.agentId ?? null,
  });
  return decision;
}

function didLast4(did: string): string {
  return String(did).replace(/\D/g, "").slice(-4);
}
