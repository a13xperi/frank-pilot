import { logger } from "../../utils/logger";
import { createMagicLink, logMagicLink } from "../auth/magic-link-service";
import { TwilioService } from "../integrations/twilio";
import { normalizePhone } from "../voice-intake/service";
import {
  registerToolHandler,
  type ToolCallbackContext,
  type ToolCallbackResult,
} from "../voice-intake/tool-callbacks";
import {
  issueCode,
  isConversationVerified,
  maskPhone,
  resolveApplicant,
  summarizeHistory,
} from "./service";

/**
 * Phase 2 in-call voice tools: `send_verification` + `get_caller_history`.
 *
 * Both are dispatched by the existing HMAC-verified, idempotent receiver at
 * POST /api/webhooks/elevenlabs/tools/:tool_name (voice-intake/tool-callbacks.ts).
 * We only register the two handlers here; we do NOT build a new receiver.
 *
 * Flag gate: every handler fails closed when VOICE_VERIFICATION_ENABLED !==
 * "true". The receiver also 503s when its own VOICE_TOOLS_ENABLED is off, and
 * registration is gated again in src/index.ts — belt, suspenders, and a belt.
 *
 * Twilio + magic-links are REUSED (TwilioService.sendSMS, createMagicLink /
 * createMagicLinkByUserId). Nothing here re-implements either.
 *
 * Tape stamp: the parent dispatcher already emits VOICE_TOOL_INVOKED with the
 * handler's ok outcome — we do NOT double-stamp.
 */

const FLAG = "VOICE_VERIFICATION_ENABLED";

let twilioService: TwilioService | null = null;
function getTwilioService(): TwilioService {
  if (!twilioService) twilioService = new TwilioService();
  return twilioService;
}

function flagOn(): boolean {
  return process.env[FLAG] === "true";
}

function pickString(parameters: Record<string, unknown>, key: string): string | null {
  const value = parameters[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** phone may arrive as `phone`, `caller_phone`, or `caller_id` (the dynamic var). */
function pickPhone(parameters: Record<string, unknown>): string | null {
  const raw =
    pickString(parameters, "phone") ??
    pickString(parameters, "caller_phone") ??
    pickString(parameters, "caller_id");
  return normalizePhone(raw);
}

function pickApplicantId(parameters: Record<string, unknown>): string | null {
  return pickString(parameters, "applicant_id") ?? pickString(parameters, "applicantId");
}

function pickEmail(parameters: Record<string, unknown>): string | null {
  return pickString(parameters, "email");
}

// ───────────────────────────────────────────────────────────────────────────
// send_verification
// ───────────────────────────────────────────────────────────────────────────

const SMS_BRAND = "Community Development Programs Center of Nevada";

export async function sendVerificationHandler(
  parameters: Record<string, unknown>,
  context: ToolCallbackContext
): Promise<ToolCallbackResult> {
  if (!flagOn()) return { ok: false, message: "Voice verification disabled" };

  const phone = pickPhone(parameters);
  const applicantId = pickApplicantId(parameters);
  const email = pickEmail(parameters);

  if (!phone) {
    logger.warn("send_verification missing phone", {
      conversationId: context.conversationId,
    });
    return {
      ok: false,
      message:
        "I don't have a phone number to text. Can you tell me the best number to reach you, or the number on your application?",
    };
  }

  // Resolve the caller so we can mint a magic-link to THEIR portal account and
  // tag the verification row with the applicant. If we can't resolve a user we
  // still verify (code-only) — the link is best-effort.
  const applicant = await resolveApplicant({ applicantId, email, phone });

  // Mint a tenant-PORTAL magic-link via the EXISTING magic-link service. It is
  // keyed on the user's email (createMagicLink → TENANT_PORTAL_URL/auth/callback
  // ?token=...), so prefer the resolved applicant email, then any email param.
  // The link is best-effort: a code-only SMS still verifies the caller.
  const linkEmail = applicant?.email ?? email;
  const magic = linkEmail ? await createMagicLink(linkEmail) : null;

  // Mint + store the code server-side (hashed). The raw code is returned to the
  // agent so it can read it back to the caller — intentional per product design.
  const { code } = await issueCode({
    conversationId: context.conversationId,
    phone,
    applicantId: applicant?.id ?? null,
  });

  const link = magic?.link ?? null;
  const body = link
    ? `It's Frank. Here's your private link, tap anytime: ${link} . Your code is ${code}.`
    : `It's Frank from ${SMS_BRAND}. Your verification code is ${code}.`;

  const sendResult = await getTwilioService().sendSMS(phone, body);

  if (link) logMagicLink(linkEmail ?? `applicant:${applicant?.id ?? "unknown"}`, link);

  logger.info("send_verification issued", {
    conversationId: context.conversationId,
    phoneMasked: maskPhone(phone),
    resolved: Boolean(applicant),
    hasLink: Boolean(link),
    smsSent: sendResult.sent,
  });

  // Return shape pinned by the switchboard sim scenarios:
  //   { ok: true, result: { sent, code, to, link } }
  return {
    ok: true,
    result: {
      sent: sendResult.sent,
      code,
      to: maskPhone(phone),
      link: link ?? "",
    },
    message: link
      ? "I just texted you a private link and a verification code. Read the code back to me and I'll confirm it's you."
      : "I just texted you a verification code. Read it back to me and I'll confirm it's you.",
  };
}

// ───────────────────────────────────────────────────────────────────────────
// get_caller_history
// ───────────────────────────────────────────────────────────────────────────

export async function getCallerHistoryHandler(
  parameters: Record<string, unknown>,
  context: ToolCallbackContext
): Promise<ToolCallbackResult> {
  if (!flagOn()) return { ok: false, message: "Voice verification disabled" };

  const phone = pickPhone(parameters);
  const applicantId = pickApplicantId(parameters);
  const email = pickEmail(parameters);

  // Defense-in-depth verified flag. The PRIMARY identity gate (don't reveal
  // history until the code is read back) is enforced in the agent prompt; we
  // surface a server-side verified flag here so the agent can corroborate it.
  const verified = await isConversationVerified(context.conversationId);

  const applicant = await resolveApplicant({ applicantId, email, phone });

  if (!applicant) {
    logger.info("get_caller_history no applicant resolved", {
      conversationId: context.conversationId,
      phoneMasked: maskPhone(phone),
    });
    return {
      ok: true,
      result: {
        found: false,
        verified,
        last_contact: null,
        summary: "I don't have a record matching that number yet.",
      },
    };
  }

  const history = await summarizeHistory(applicant.id, applicant.status);

  logger.info("get_caller_history resolved", {
    conversationId: context.conversationId,
    found: history.found,
    verified,
    hasLastContact: Boolean(history.lastContact),
  });

  // Return shape pinned by the switchboard sim scenarios:
  //   { ok: true, result: { found, verified, last_contact, summary } }
  return {
    ok: true,
    result: {
      found: history.found,
      verified,
      last_contact: history.lastContact,
      summary: history.summary,
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Registration
// ───────────────────────────────────────────────────────────────────────────

let registered = false;
/**
 * Idempotent registration helper. Boot calls this once (gated on the flag in
 * src/index.ts); tests can also call it after clearToolHandlersForTests().
 */
export function registerVoiceVerificationHandlers(): void {
  if (registered) return;
  registerToolHandler("send_verification", sendVerificationHandler);
  registerToolHandler("get_caller_history", getCallerHistoryHandler);
  registered = true;
}

/** Test-only: reset the one-time gate so jest can re-register fresh. */
export function __resetRegistrationForTests(): void {
  registered = false;
}
