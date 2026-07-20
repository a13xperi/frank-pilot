import { logger } from "../../utils/logger";
import { createFollowUp } from "../follow-ups/service";
import {
  registerToolHandler,
  type ToolCallbackContext,
  type ToolCallbackResult,
} from "./tool-callbacks";

/**
 * `request_transfer` — files a unit-transfer request from an inbound Frank call
 * and hands the caller a spoken reference number.
 *
 * WHY: the front-desk prompt ROUTES unit-transfer asks, but Frank had no tool to
 * actually FILE one — so he promised a transfer he couldn't create
 * (FRANK-LAUNCH-ADDENDUM §3 item 2 / Jul1-#32). This closes that gap: it durably
 * records the request and returns a human-readable ticket id Frank reads back.
 *
 * REUSE, NOT REBUILD (mirrors escalate_to_support in escalation.ts): the durable
 * record is a `follow_ups` row via createFollowUp() — the same spine the callback
 * dialer and the escalation tool already drain — so there is NO migration and NO
 * new store. Two deliberate markers make a transfer distinct from a callback:
 *   - source = 'voice_intake_transfer'  → an ops/compliance queue drains
 *     transfers by this marker, separate from callbacks.
 *   - consent_outbound = false          → a transfer is a COMPLIANCE FILING, not
 *     a callback, so the follow-up dialer's consent gate (dialer.ts) skips it and
 *     it is NEVER auto-dialed.
 *
 * CLASSIFICATION IS DOWNSTREAM — NOT this tool's job. Craig's rule (Tg 2026-07-02):
 * a transfer WITHIN the same building duplicates the existing paperwork and
 * cross-references a transfer reference into both files; a move to a DIFFERENT
 * building or ANY other property is a brand-new application + a full new cert.
 * The tool only captures ENOUGH for compliance to classify (caller identity +
 * current-vs-desired property + unit) and files it; the structured payload rides
 * the row's `notes` as JSON so compliance reads it verbatim.
 *
 * DARK BUILD: flag-gated on FRANK_TRANSFER_ENABLED (this handler fails closed),
 * registration is gated AGAIN in src/index.ts, and the tool receiver 503s until
 * VOICE_TOOLS_ENABLED — belt, suspenders, and a belt. The live agent is NOT
 * wired to call it; wiring the tool into an agent's toolset (the schema below) is
 * a human PROMOTION step, never performed here.
 *
 * Tool parameter schema — for the promotion step, NOT wired here:
 *   caller_name        string  (required) full name — record-creation spell-back
 *   phone / phone_e164 string  (required) callback + identity anchor
 *   current_property   string  (required) the community/building they live in now
 *   desired_property   string  (required) the target community/building
 *   current_unit       string  (optional) their current unit number
 *   desired_unit_type  string  (optional) desired unit / bedroom count
 *   reason             string  (optional) why they want to transfer
 *   notes              string  (optional) any extra context
 *
 * Response shape the agent reads back:
 *   { ok, result: { ticket_id, request_id, status, classification }, message }
 * The parent dispatcher already stamps VOICE_TOOL_INVOKED — we do NOT double-stamp.
 */

const FLAG = "FRANK_TRANSFER_ENABLED";
const SOURCE = "voice_intake_transfer";
/** Cap caller free-text before it lands on the durable compliance record. */
const MAX_FREETEXT = 500;

function flagOn(): boolean {
  return process.env[FLAG] === "true";
}

/** First non-empty string across the accepted parameter aliases; null if none. */
function pickString(parameters: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const v = parameters[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/** Trim free-text to the record cap; null passes through. */
function cap(value: string | null): string | null {
  return value ? value.slice(0, MAX_FREETEXT) : null;
}

/**
 * "TR-" + the first 8 hex of the row UUID, uppercased — a short, speakable
 * reference that maps deterministically back to the follow_ups row
 * (id::text LIKE '<hex>%'). The full UUID rides `request_id` for exactness.
 */
export function formatTicketId(rowId: string): string {
  const hex = rowId.replace(/[^0-9a-fA-F]/g, "").slice(0, 8).toUpperCase();
  return `TR-${hex}`;
}

export async function requestTransferHandler(
  parameters: Record<string, unknown>,
  context: ToolCallbackContext
): Promise<ToolCallbackResult> {
  // Belt: fail closed when the feature flag is off (registration is gated too,
  // and the receiver 503s on VOICE_TOOLS_ENABLED — three independent guards).
  if (!flagOn()) {
    return { ok: false, message: "Transfer requests aren't available yet." };
  }

  const callerName = pickString(parameters, "caller_name", "name", "full_name");
  const phone = pickString(parameters, "phone_e164", "phone", "caller_phone", "caller_id");
  const currentProperty = pickString(
    parameters,
    "current_property",
    "from_property",
    "current_community"
  );
  const desiredProperty = pickString(
    parameters,
    "desired_property",
    "to_property",
    "desired_community"
  );
  const currentUnit = pickString(parameters, "current_unit", "unit", "unit_number");
  const desiredUnitType = pickString(parameters, "desired_unit_type", "unit_type", "bedrooms");
  const reason = pickString(parameters, "reason");
  const extraNotes = pickString(parameters, "notes");

  // Required fields — re-ask the FIRST missing one over voice (mirrors
  // schedule_followup's targeted re-ask), so Frank collects it and re-fires.
  // These four are the minimum a compliance reviewer needs to classify and act:
  // identity (name + phone) and the current-vs-desired property pivot.
  if (!phone) {
    return { ok: false, message: "What's the best phone number to put on the request?" };
  }
  if (!callerName) {
    return { ok: false, message: "Can I get your full name for the transfer request?" };
  }
  if (!currentProperty) {
    return { ok: false, message: "Which community are you living in right now?" };
  }
  if (!desiredProperty) {
    return { ok: false, message: "And which community would you like to transfer to?" };
  }

  // Structured payload for compliance — current vs desired is exactly the pivot
  // Craig's rule classifies on. Stored verbatim on the row's notes as JSON.
  const payload = {
    kind: "unit_transfer",
    caller_name: callerName,
    current_property: currentProperty,
    current_unit: currentUnit,
    desired_property: desiredProperty,
    desired_unit_type: desiredUnitType,
    reason: cap(reason),
    extra_notes: cap(extraNotes),
  };

  const row = await createFollowUp({
    phoneE164: phone,
    // free-text column (no CHECK constraint) — a clear categorical the ops queue
    // filters on alongside `source`.
    reason: "transfer_requested",
    // Filed now; it is a compliance ticket, not a scheduled callback.
    scheduledForIso: new Date().toISOString(),
    voiceCallId: context.conversationId,
    // A filing, never a callback — the dialer's consent gate skips this row.
    consentOutbound: false,
    source: SOURCE,
    notes: JSON.stringify(payload),
  });

  if (!row) {
    // createFollowUp returns null only on a phone normalizePhone rejects — re-ask.
    logger.warn("request_transfer could not file — unusable phone", {
      conversationId: context.conversationId,
    });
    return {
      ok: false,
      message: "I didn't quite catch that number — what's the best phone to reach you?",
    };
  }

  const ticketId = formatTicketId(row.id);
  // Low-PII log: ids only — the caller/property details live on the row's notes,
  // never in the log stream.
  logger.info("request_transfer filed", {
    conversationId: context.conversationId,
    followUpId: row.id,
    ticketId,
  });

  return {
    ok: true,
    result: {
      ticket_id: ticketId,
      request_id: row.id,
      status: "filed",
      classification: "pending_compliance_review",
    },
    message:
      `Done — I've filed your transfer request. Your reference number is ${ticketId}. ` +
      "Our team will review it and follow up with you on the next steps.",
  };
}

let registered = false;
/**
 * Idempotent boot registration (mirrors registerEscalationHandler). src/index.ts
 * calls this ONLY when FRANK_TRANSFER_ENABLED is on; the handler also fails
 * closed on the same flag.
 */
export function registerRequestTransferHandler(): void {
  if (registered) return;
  registerToolHandler("request_transfer", requestTransferHandler);
  registered = true;
}

/** Test-only: reset the one-time gate so jest can re-register fresh. */
export function __resetRegistrationForTests(): void {
  registered = false;
}
