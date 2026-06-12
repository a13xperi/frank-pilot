/**
 * ElevenLabs Conversational AI outbound dialer.
 *
 * Thin, mockable boundary around the one upstream call. The service layer
 * owns ALL policy (consent, quiet hours, review state) — by the time
 * `placeOutboundCall` runs, the call has already been judged legal and
 * approved by a human.
 *
 * Fail-closed layering, mirroring the VOICE_INTAKE_ENABLED pattern:
 *   - VOICE_OUTBOUND_ENABLED        — mounts the routes at all (src/index.ts)
 *   - VOICE_OUTBOUND_DIALING_ENABLED — actually places calls. Off → every
 *     dial is a dry run: full pipeline, tape stamp flagged dryRun, no PSTN
 *     traffic. This is the rehearsal mode for the go-live week.
 *
 * Config (all required for a real dial; absence → explicit failure, never a
 * silent fallback):
 *   ELEVENLABS_API_KEY               — shared with the inbound webhook proxy
 *   ELEVENLABS_OUTBOUND_AGENT_ID     — the outbound-flavored Frank agent
 *   ELEVENLABS_AGENT_PHONE_NUMBER_ID — the imported 725 number's ElevenLabs id
 */

import { logger } from "../../utils/logger";

const ELEVENLABS_API_BASE = "https://api.elevenlabs.io";

export interface DialRequest {
  toNumber: string;
  queueId: string;
  entryId: string;
  /** Injected into the agent as dynamic variables (first name, property…). */
  dynamicVariables?: Record<string, string>;
}

export interface DialOutcome {
  dryRun: boolean;
  ok: boolean;
  conversationId: string | null;
  callSid: string | null;
  error?: string;
}

export function dialingEnabled(): boolean {
  return process.env.VOICE_OUTBOUND_DIALING_ENABLED === "true";
}

export async function placeOutboundCall(req: DialRequest): Promise<DialOutcome> {
  if (!dialingEnabled()) {
    logger.info("outbound dial dry-run (VOICE_OUTBOUND_DIALING_ENABLED off)", {
      queueId: req.queueId,
      entryId: req.entryId,
    });
    return { dryRun: true, ok: true, conversationId: null, callSid: null };
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  const agentId = process.env.ELEVENLABS_OUTBOUND_AGENT_ID;
  const phoneNumberId = process.env.ELEVENLABS_AGENT_PHONE_NUMBER_ID;
  if (!apiKey || !agentId || !phoneNumberId) {
    return {
      dryRun: false,
      ok: false,
      conversationId: null,
      callSid: null,
      error: "missing_config",
    };
  }

  try {
    const res = await fetch(`${ELEVENLABS_API_BASE}/v1/convai/twilio/outbound-call`, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        agent_id: agentId,
        agent_phone_number_id: phoneNumberId,
        to_number: req.toNumber,
        conversation_initiation_client_data: {
          dynamic_variables: req.dynamicVariables ?? {},
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.error("outbound dial upstream error", {
        queueId: req.queueId,
        status: res.status,
        body: body.slice(0, 300),
      });
      return {
        dryRun: false,
        ok: false,
        conversationId: null,
        callSid: null,
        error: `upstream_${res.status}`,
      };
    }

    const payload = (await res.json()) as {
      conversation_id?: string;
      callSid?: string;
      call_sid?: string;
    };
    return {
      dryRun: false,
      ok: true,
      conversationId: payload.conversation_id ?? null,
      callSid: payload.callSid ?? payload.call_sid ?? null,
    };
  } catch (err) {
    logger.error("outbound dial failed", {
      queueId: req.queueId,
      error: (err as Error).message,
    });
    return { dryRun: false, ok: false, conversationId: null, callSid: null, error: "network_error" };
  }
}
