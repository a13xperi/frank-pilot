import { logger } from "../../utils/logger";
import {
  registerToolHandler,
  type ToolCallbackContext,
  type ToolCallbackResult,
} from "../voice-intake/tool-callbacks";
import { markItemByPhone, computeMissingByPhone, summarizeMissing } from "./service";
import { CATALOG_BY_KEY, type RequirementStatus } from "./catalog";

/**
 * Voice tool: `mark_requirement` — record that an applicant provided (or a PM
 * confirmed) one of the discrete requirement items, e.g. when a returning,
 * verified caller says "here are my pay stubs". Phone-keyed (resolves the latest
 * application on that number) so Frank never needs the application id mid-call.
 *
 * This is the manual/in-call receipt path; column-derived items (Stripe Identity
 * verdict, income verification) flip on their own via the screening pipeline.
 * Marking the last open item auto-closes the document-chase follow-up loop (see
 * service.markItem → resolveFollowupsIfComplete), so Frank never calls back about
 * a gap that's already filled.
 *
 * Returns the standard { ok, result, message } — the agent reads `message`.
 */

const VALID_STATUS: RequirementStatus[] = ["missing", "received", "verified", "waived"];

export async function markRequirementHandler(
  parameters: Record<string, unknown>,
  context: ToolCallbackContext
): Promise<ToolCallbackResult> {
  const phone = pickString(parameters, "phone_e164") ?? pickString(parameters, "phone");
  const itemKey = pickString(parameters, "item_key");
  const statusRaw = (pickString(parameters, "status") ?? "received").toLowerCase();

  if (!phone) {
    return { ok: false, message: "What's the best phone number on the account?" };
  }
  if (!itemKey || !CATALOG_BY_KEY.has(itemKey)) {
    return {
      ok: false,
      result: { valid_items: Array.from(CATALOG_BY_KEY.keys()) },
      message: "I'm not sure which item that is — let me note it and a teammate will follow up.",
    };
  }
  const status = (VALID_STATUS.includes(statusRaw as RequirementStatus)
    ? statusRaw
    : "received") as RequirementStatus;

  const marked = await markItemByPhone(phone, itemKey, status, `voice:${context.conversationId}`);
  if (!marked.ok) {
    logger.info("mark_requirement no application", { conversationId: context.conversationId });
    return {
      ok: false,
      message: "I couldn't find an application on that number to update just yet.",
    };
  }

  const { missing } = await computeMissingByPhone(phone);
  logger.info("mark_requirement", {
    conversationId: context.conversationId,
    itemKey,
    status,
    remaining: missing.length,
  });

  const message = missing.length
    ? `Got it — that's noted. We ${summarizeMissing(missing)}.`
    : "Perfect — that was the last thing we needed. You're all set.";

  return {
    ok: true,
    result: {
      item_key: itemKey,
      status,
      application_id: marked.applicationId,
      remaining: missing.map((m) => m.key),
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
export function registerRequirementHandlers(): void {
  if (registered) return;
  registerToolHandler("mark_requirement", markRequirementHandler);
  registered = true;
}

export function __resetRegistrationForTests(): void {
  registered = false;
}
