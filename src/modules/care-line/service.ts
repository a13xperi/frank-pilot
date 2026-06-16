/**
 * Care Line capture service — the unified front door for resident reports.
 *
 * handleCareLinePostCall() maps an ElevenLabs post-call payload (the agent's
 * structured data_collection_results) into a care_incidents row, classifies
 * severity, decides escalation, and stamps the compliance tape. It does NOT
 * auto-create work orders or lease violations — sensitive categories route to
 * human triage (see taxonomy.ts). Ships DARK behind CARE_LINE_ENABLED.
 *
 * captureIncident() is channel-agnostic so the inbound anonymous-tips line
 * (voice/SMS/web) writes through the same path + anonymity model.
 */

import crypto from "crypto";
import { query } from "../../config/database";
import { logger } from "../../utils/logger";
import { stampTape } from "../tape";
import { pickField, type PostCallPayload } from "../voice-intake/service";
import {
  coerceCategory,
  isSeverity,
  resolveSeverity,
  routingFor,
  type Category,
  type RoutingIntent,
  type Severity,
} from "./taxonomy";
import { evaluateEscalation } from "./escalation";

export function isCareLineEvent(payload: PostCallPayload): boolean {
  const careAgentId = process.env.ELEVENLABS_CARE_LINE_AGENT_ID ?? "";
  return Boolean(careAgentId) && payload.agent_id === careAgentId;
}

/** data_collection_results values arrive as {value,...}; read booleans from both shapes. */
function readBool(results: Record<string, unknown> | undefined, key: string): boolean | null {
  if (!results) return null;
  const entry = results[key];
  if (!entry || typeof entry !== "object") return null;
  const value = (entry as { value?: unknown }).value;
  if (typeof value === "boolean") return value;
  if (typeof value === "string" && value.trim()) {
    if (/^(true|yes|1|y)$/i.test(value.trim())) return true;
    if (/^(false|no|0|n)$/i.test(value.trim())) return false;
  }
  return null;
}

const RC_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no ambiguous I/O/0/1/L
function mintReferenceCode(): string {
  let s = "";
  for (let i = 0; i < 4; i++) s += RC_ALPHABET[crypto.randomInt(RC_ALPHABET.length)];
  return `FRANK-${s}`;
}

export type Channel = "voice_outbound" | "voice_inbound" | "sms" | "web";

export interface CaptureInput {
  category: Category;
  severity: Severity;
  status: "captured" | "triaged" | "routed" | "escalated";
  routingIntent: RoutingIntent;
  summaryWhat: string;
  whereBuilding?: string | null;
  whereFloor?: string | null;
  whereUnit?: string | null;
  whereAmenity?: string | null;
  occurredWhen?: string | null;
  whoAffected?: string | null;
  safetyFlag: boolean;
  selfHarmFlag: boolean;
  residentRequest?: string | null;
  promiseMade?: string | null;
  reporterKind: "named" | "anonymous";
  reporterName?: string | null;
  reporterPhone?: string | null;
  callbackOptIn: boolean;
  callbackPhone?: string | null;
  channel: Channel;
  propertyId?: string | null;
  conversationId?: string | null;
  rawPayload?: unknown;
}

export interface CaptureResult {
  id: string;
  referenceCode: string;
}

/** Insert one incident, minting a unique reference code (retry on collision). */
export async function captureIncident(input: CaptureInput): Promise<CaptureResult> {
  // Anonymity guarantee mirrored in code (the DB CHECK is the backstop).
  const named = input.reporterKind === "named";
  const reporterName = named ? input.reporterName ?? null : null;
  const reporterPhone = named ? input.reporterPhone ?? null : null;

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = mintReferenceCode();
    try {
      const res = await query(
        `INSERT INTO care_incidents
           (reference_code, severity, category, status, routing_intent, summary_what,
            where_building, where_floor, where_unit, where_amenity, occurred_when, who_affected,
            safety_flag, self_harm_flag, resident_request, promise_made,
            reporter_kind, reporter_name, reporter_phone, callback_opt_in, callback_phone,
            channel, property_id, conversation_id, raw_payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25::jsonb)
         RETURNING id, reference_code`,
        [
          code, input.severity, input.category, input.status, input.routingIntent, input.summaryWhat,
          input.whereBuilding ?? null, input.whereFloor ?? null, input.whereUnit ?? null,
          input.whereAmenity ?? null, input.occurredWhen ?? null, input.whoAffected ?? null,
          input.safetyFlag, input.selfHarmFlag, input.residentRequest ?? null, input.promiseMade ?? null,
          input.reporterKind, reporterName, reporterPhone, input.callbackOptIn, input.callbackPhone ?? null,
          input.channel, input.propertyId ?? null, input.conversationId ?? null,
          JSON.stringify(input.rawPayload ?? {}),
        ]
      );
      return { id: res.rows[0].id, referenceCode: res.rows[0].reference_code };
    } catch (err) {
      if ((err as { code?: string }).code === "23505" && attempt < 4) continue; // dup code, retry
      throw err;
    }
  }
  throw new Error("care-line: could not mint a unique reference code");
}

export async function handleCareLinePostCall(payload: PostCallPayload): Promise<void> {
  if (process.env.CARE_LINE_ENABLED !== "true") {
    logger.info("care-line: post-call ignored (CARE_LINE_ENABLED off)", {
      conversationId: payload.conversation_id,
    });
    return;
  }

  const data = payload.analysis?.data_collection_results;
  const category = coerceCategory(pickField(data, "incident_category"));
  const rawSeverity = pickField(data, "incident_severity");
  const agentSeverity: Severity | null = isSeverity(rawSeverity) ? rawSeverity : null;
  const safetyFlag = readBool(data, "safety_flag") === true;
  const selfHarmFlag = readBool(data, "self_harm_flag") === true;
  const severity = resolveSeverity(category, agentSeverity, safetyFlag, selfHarmFlag);
  const reporterKind = pickField(data, "reporter_kind") === "anonymous" ? "anonymous" : "named";

  const decision = evaluateEscalation({
    severity,
    safetyFlag,
    selfHarmFlag,
    isBusinessHours: true, // calls only place in the recipient-local window (dialer.ts)
  });

  const echoed = (payload as unknown as {
    conversation_initiation_client_data?: { dynamic_variables?: Record<string, unknown> };
  }).conversation_initiation_client_data?.dynamic_variables?.property_id;
  const propertyId = typeof echoed === "string" && echoed ? echoed : null;

  const captured = await captureIncident({
    category,
    severity,
    status: decision.escalate ? "escalated" : "triaged",
    routingIntent: routingFor(category),
    summaryWhat: pickField(data, "summary_what") || "(no summary captured)",
    whereBuilding: pickField(data, "where_building"),
    whereFloor: pickField(data, "where_floor"),
    whereUnit: pickField(data, "where_unit"),
    whereAmenity: pickField(data, "where_amenity"),
    occurredWhen: pickField(data, "occurred_when"),
    whoAffected: pickField(data, "who_affected"),
    safetyFlag,
    selfHarmFlag,
    residentRequest: pickField(data, "resident_request"),
    promiseMade: pickField(data, "promise_made"),
    reporterKind,
    reporterName: pickField(data, "reporter_name"),
    reporterPhone: pickField(data, "reporter_phone"),
    callbackOptIn: readBool(data, "callback_opt_in") === true,
    callbackPhone: pickField(data, "callback_phone"),
    channel: "voice_outbound",
    propertyId,
    conversationId: payload.conversation_id,
    rawPayload: payload,
  });

  if (decision.escalate) {
    // Durable "a human was flagged" record. SMS paging is gated + a follow-up;
    // default to tape_only so the escalation never silently vanishes.
    await query(
      `INSERT INTO care_escalations (incident_id, reason, notified_via)
       VALUES ($1, $2, $3)`,
      [captured.id, decision.reason ?? "escalation", "tape_only"]
    );
    void stampTape({
      kind: "CARE_LINE_ESCALATED",
      actor: "care-line-agent",
      sessionId: payload.conversation_id,
      payload: {
        incidentId: captured.id,
        referenceCode: captured.referenceCode,
        severity,
        reason: decision.reason,
        tell911: Boolean(decision.tell911),
        refer988: Boolean(decision.refer988),
      },
    });
  }

  void stampTape({
    kind: "CARE_LINE_CALL_CAPTURED",
    actor: "care-line-agent",
    sessionId: payload.conversation_id,
    payload: {
      incidentId: captured.id,
      referenceCode: captured.referenceCode,
      conversationId: payload.conversation_id,
      agentId: payload.agent_id,
      category,
      severity,
      reporterKind,
      routingIntent: routingFor(category),
    },
  });

  logger.info("care-line: incident captured", {
    incidentId: captured.id,
    referenceCode: captured.referenceCode,
    category,
    severity,
    escalated: decision.escalate,
  });
}
