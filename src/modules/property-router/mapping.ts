import { query } from "../../config/database";
import { logger } from "../../utils/logger";
import { normalizeDid, type RoutingRow } from "./service";

/**
 * Property→agent mapping management (Frank core C4).
 *
 * CRUD over property_agent_routing rows — the data the router consults. Kept
 * separate from service.ts (the routing logic) so the read path stays lean.
 *
 * SCOPE: writes only this lookup table. Assigning a real DID to a real agent in
 * the telephony console is a manual, gated step this code never performs.
 */

export interface UpsertMappingInput {
  propertyId: string;
  agentId: string;
  agentLabel?: string | null;
  inboundDid?: string | null;
  channels?: string[];
  priority?: number;
  active?: boolean;
}

const VALID_CHANNELS = new Set(["voice", "sms", "web"]);

/** Insert or update (by property+agent+priority) one mapping. */
export async function upsertMapping(input: UpsertMappingInput): Promise<RoutingRow> {
  const channels = Array.isArray(input.channels)
    ? input.channels.map(String).filter((c) => VALID_CHANNELS.has(c))
    : [];
  const priority = Number.isFinite(input.priority) ? Math.floor(input.priority!) : 100;
  // Store the DID in a normalized +E.164 shape (digits only here is fine; the
  // by-DID lookup compares on digits). Keep the leading + for display.
  const didDigits = normalizeDid(input.inboundDid);
  const inboundDid = didDigits ? `+${didDigits.length === 10 ? "1" + didDigits : didDigits}` : null;

  const result = await query(
    `INSERT INTO property_agent_routing
       (property_id, agent_id, agent_label, inbound_did_e164, channels, priority, active)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (property_id, agent_id, priority) DO UPDATE SET
       agent_label = EXCLUDED.agent_label,
       inbound_did_e164 = EXCLUDED.inbound_did_e164,
       channels = EXCLUDED.channels,
       active = EXCLUDED.active,
       updated_at = NOW()
     RETURNING id, property_id, agent_id, agent_label, inbound_did_e164,
               channels, priority, active`,
    [
      input.propertyId,
      input.agentId,
      input.agentLabel ?? null,
      inboundDid,
      channels,
      priority,
      input.active ?? true,
    ]
  );
  const row = result.rows[0] as RoutingRow;
  logger.info("Property→agent mapping upserted", {
    propertyId: input.propertyId,
    agentId: input.agentId,
    priority,
    active: row.active,
  });
  return row;
}

/** Soft-disable a mapping (keeps the row for audit). Returns whether a row changed. */
export async function deactivateMapping(id: string): Promise<boolean> {
  const result = await query(
    `UPDATE property_agent_routing SET active = FALSE, updated_at = NOW()
      WHERE id = $1 AND active = TRUE`,
    [id]
  );
  return (result.rowCount ?? 0) > 0;
}

/** All mappings for a property (active + inactive), best priority first. */
export async function listMappings(propertyId: string): Promise<RoutingRow[]> {
  const result = await query(
    `SELECT id, property_id, agent_id, agent_label, inbound_did_e164,
            channels, priority, active
       FROM property_agent_routing
      WHERE property_id = $1
      ORDER BY active DESC, priority ASC, agent_id ASC`,
    [propertyId]
  );
  return result.rows as RoutingRow[];
}
