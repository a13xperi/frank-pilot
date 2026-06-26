/**
 * deal-tool.ts - ElevenLabs in-call server tool `ask_deal_docs` for the hosted
 * Frank Deal Desk line.
 *
 * An ENROLLED caller asks the deal corpus a question; this returns a SHORT,
 * compartment-masked, phone-speakable answer the agent reads back VERBATIM.
 *
 * Fail-closed, defense-in-depth. The router in tool-callbacks.ts already enforced
 * VOICE_TOOLS_ENABLED + the x-frank-tool-secret header before we run; on top of
 * that:
 *   1. AGENT PIN. Only DEAL_DESK_AGENT_ID may invoke this tool. Even if it is
 *      mis-wired onto the LIVE tenant 725 agent, we refuse - the tenant line can
 *      never reach deal docs. When a pin is configured we also refuse a missing
 *      agent id (can't verify -> refuse).
 *   2. CALLER AUTH. resolveVoiceEnrollment(caller_id) against a fail-closed phone
 *      allow-list. Unknown caller -> politely refused, NEVER answered. caller_id
 *      is only ever a lookup key; we never trust a client-supplied tier.
 *   3. FLOOR + MASK. voiceGroundAnswer masks at >= privileged before returning.
 *
 * Read-only: no DB writes, nothing leaves to a human. The router stamps the tape
 * (VOICE_TOOL_INVOKED) and handles idempotency; we do not double-stamp.
 *
 * caller_id / agent_id arrive in the flat tool body because the EL tool is
 * configured with params caller_id={{system__caller_id}} and
 * agent_id={{system__agent_id}}. Neither is LLM-editable.
 */
import crypto from "crypto";
import { logger } from "../../utils/logger";
import {
  registerToolHandler,
  type ToolCallbackContext,
  type ToolCallbackResult,
} from "./tool-callbacks";
import { resolveVoiceEnrollment, voiceGroundAnswer } from "./deal-voice";

export const ASK_DEAL_DOCS_TOOL = "ask_deal_docs";

// Spoken to the caller, so keep refusals human and non-leaky. ok:false makes the
// agent read the message as a polite "can't do that" (HTTP stays 200 per the
// router's auto-disable-budget policy).
const REFUSE_AGENT = "I'm only able to look up deal documents on the deal desk line.";
const REFUSE_NOT_ENROLLED =
  "I'm not able to share deal details on this call, but I'll let Alex know you reached out.";
const NEED_QUESTION =
  "What would you like to know about the deal? I didn't catch a question.";
const EMPTY_ANSWER = "I don't have that in the deal materials. I'll flag it for Alex.";
const GUARD_BLOCKED = "That's outside what I can share on this line. I'll flag it for Alex.";

export async function askDealDocsHandler(
  parameters: Record<string, unknown>,
  context: ToolCallbackContext
): Promise<ToolCallbackResult> {
  // 1. Agent pin (defense-in-depth; the tenant 725 agent can never reach here).
  const expectedAgent = (process.env.DEAL_DESK_AGENT_ID || "").trim();
  if (expectedAgent && context.agentId !== expectedAgent) {
    logger.warn("ask_deal_docs refused: agent pin", {
      agentId: context.agentId || "(none)",
    });
    return { ok: false, message: REFUSE_AGENT };
  }

  // 2. Caller auth - fail-closed phone allow-list. Unknown -> refused, never answered.
  const callerId = pickString(parameters, "caller_id") ?? "";
  const enrollment = resolveVoiceEnrollment(callerId);
  if (!enrollment.enrolled) {
    logger.info("ask_deal_docs refused: caller not enrolled", {
      caller: hashCaller(callerId),
    });
    return { ok: false, message: REFUSE_NOT_ENROLLED };
  }

  const question = pickString(parameters, "question") ?? "";
  if (!question) return { ok: false, message: NEED_QUESTION };

  // 3. Floor + mask. voiceGroundAnswer floors to >= privileged and masks the
  //    retrieved passage before it ever reaches the speaking agent.
  const answer = voiceGroundAnswer(question, enrollment.tier);
  if (answer.empty) return { ok: true, message: EMPTY_ANSWER };
  if (!answer.ok || !answer.spoken) return { ok: false, message: GUARD_BLOCKED };

  logger.info("ask_deal_docs answered", {
    caller: hashCaller(callerId),
    tier: enrollment.tier,
    withheld: !!answer.withheld,
    maskedClasses: answer.maskedClasses,
  });

  return {
    ok: true,
    result: { withheld: !!answer.withheld },
    message: answer.spoken,
  };
}

function pickString(params: Record<string, unknown>, key: string): string | null {
  const value = params[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

// Never log a raw caller phone. Short, stable, non-reversible audit tag.
function hashCaller(raw: string): string {
  if (!raw) return "c_none";
  return "c_" + crypto.createHash("sha256").update(String(raw)).digest("hex").slice(0, 10);
}

let registered = false;
/** Idempotent boot registration. Tests call it after clearToolHandlersForTests(). */
export function registerDealDocsToolHandler(): void {
  if (registered) return;
  registerToolHandler(ASK_DEAL_DOCS_TOOL, askDealDocsHandler);
  registered = true;
}

/** Test-only: reset the one-time gate so jest can re-register fresh. */
export function __resetDealDocsRegistrationForTests(): void {
  registered = false;
}
