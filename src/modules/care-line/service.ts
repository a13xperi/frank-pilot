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
 *
 * ANONYMITY CONTRACT (§8): for reporter_kind='anonymous' NO identity is ever
 * persisted — not name/phone, not a callback number, not the conversation id,
 * and NOT the raw payload (which carries the transcript + audio url). Enforced
 * here in code AND backstopped by the care_incidents_anon_no_pii DB CHECK.
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
import { isWithinCareCallWindow } from "./dialer";

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

// 8 chars from a 30-char unambiguous alphabet ≈ 6.5e11 space. The reference code
// is a bearer check-back token for anonymous reporters — treat it as a secret
// (any future lookup endpoint must rate-limit and not confirm existence on miss).
const RC_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function mintReferenceCode(): string {
  let s = "";
  for (let i = 0; i < 8; i++) s += RC_ALPHABET[crypto.randomInt(RC_ALPHABET.length)];
  return `FRANK-${s}`;
}

async function propertyTimezone(propertyId: string | null): Promise<string | null> {
  if (!propertyId) return null;
  try {
    const r = await query(`SELECT timezone FROM properties WHERE id = $1`, [propertyId]);
    return (r.rows[0]?.timezone as string) ?? null;
  } catch {
    return null;
  }
}

async function findActiveOnCall(propertyId: string | null): Promise<{ id: string } | null> {
  if (!propertyId) return null;
  try {
    const r = await query(
      `SELECT user_id AS id FROM on_call_assignments
        WHERE property_id = $1 AND shift_start <= now() AND shift_end >= now()
        ORDER BY shift_start DESC LIMIT 1`,
      [propertyId]
    );
    return r.rows[0] ?? null;
  } catch {
    return null;
  }
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
  // ANONYMITY: an anonymous report stores NOTHING that could re-identify the
  // reporter — name, phone, callback number, the conversation id, and the raw
  // payload (transcript + audio url) are all suppressed. The DB CHECK backstops it.
  const anon = input.reporterKind === "anonymous";
  const reporterName = anon ? null : input.reporterName ?? null;
  const reporterPhone = anon ? null : input.reporterPhone ?? null;
  const callbackPhone = anon ? null : input.callbackPhone ?? null;
  const callbackOptIn = anon ? false : input.callbackOptIn;
  const conversationId = anon ? null : input.conversationId ?? null;
  const rawPayloadParam = anon ? null : JSON.stringify(input.rawPayload ?? {});

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
          input.reporterKind, reporterName, reporterPhone, callbackOptIn, callbackPhone,
          input.channel, input.propertyId ?? null, conversationId, rawPayloadParam,
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

  const echoed = (payload as unknown as {
    conversation_initiation_client_data?: { dynamic_variables?: Record<string, unknown> };
  }).conversation_initiation_client_data?.dynamic_variables?.property_id;
  const propertyId = typeof echoed === "string" && echoed ? echoed : null;

  // Recipient-local business hours from the property timezone; unknown tz →
  // treat as after-hours so an active P1 still pages on-call (escalate-up).
  const tz = await propertyTimezone(propertyId);
  const isBusinessHours = tz ? isWithinCareCallWindow(new Date(), tz) : false;

  const decision = evaluateEscalation({ severity, safetyFlag, selfHarmFlag, isBusinessHours });

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

  // Permanent opt-out signal (TCPA). The durable DNC store + dial-time gate is a
  // hard go-live prerequisite (no dialer ships yet) — here we capture + stamp it.
  if (readBool(data, "opt_out") === true) {
    void stampTape({
      kind: "CARE_LINE_OPTOUT",
      actor: "care-line-agent",
      sessionId: payload.conversation_id,
      payload: { incidentId: captured.id, referenceCode: captured.referenceCode },
    });
    logger.warn("care-line: resident opt-out — add to DNC before any future dial", {
      incidentId: captured.id,
    });
  }

  if (decision.escalate) {
    // Resolve the on-call human and record how they were (or weren't) reached.
    // Real SMS paging is gated behind CARE_LINE_ONCALL_SMS_ENABLED (a go-live
    // step); until then the escalation is durably recorded + tape-stamped so it
    // is never silently dropped, and a missing on-call fails LOUD.
    const onCall = decision.pageOnCall ? await findActiveOnCall(propertyId) : null;
    let notifiedVia: "sms" | "tape_only" | "none_available" = "tape_only";
    if (decision.pageOnCall) {
      if (!onCall) {
        notifiedVia = "none_available";
        logger.warn("care-line: ESCALATION with no active on-call assignment", {
          incidentId: captured.id,
          severity,
          reason: decision.reason,
        });
      } else if (process.env.CARE_LINE_ONCALL_SMS_ENABLED === "true") {
        notifiedVia = "sms";
        // TODO(go-live): send via src/modules/integrations/twilio. Stubbed while dark.
        logger.warn("care-line: would page on-call via SMS (paging stub — flag on)", {
          incidentId: captured.id,
          onCallUserId: onCall.id,
        });
      }
    }
    await query(
      `INSERT INTO care_escalations (incident_id, reason, on_call_user_id, notified_via)
       VALUES ($1, $2, $3, $4)`,
      [captured.id, decision.reason ?? "escalation", onCall?.id ?? null, notifiedVia]
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
        pageOnCall: Boolean(decision.pageOnCall),
        notifiedVia,
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
      conversationId: reporterKind === "anonymous" ? null : payload.conversation_id,
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
