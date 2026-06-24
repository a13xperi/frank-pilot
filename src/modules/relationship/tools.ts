import { logger } from "../../utils/logger";
import {
  registerToolHandler,
  type ToolCallbackContext,
  type ToolCallbackResult,
} from "../voice-intake/tool-callbacks";
import { getLedgerByPhone } from "./ledger";

/**
 * get_ledger — Frank recounts the person's journey ("here's everything that's
 * happened for you"). The voice-facing read of the ledger of truth.
 */
export async function getLedgerHandler(
  parameters: Record<string, unknown>,
  context: ToolCallbackContext
): Promise<ToolCallbackResult> {
  const phone = pickString(parameters, "phone_e164") ?? pickString(parameters, "phone");
  if (!phone) return { ok: false, message: "What number should I pull up the history for?" };

  const entries = await getLedgerByPhone(phone, 25);
  logger.info("get_ledger", { conversationId: context.conversationId, count: entries.length });

  if (!entries.length) {
    return { ok: true, result: { entries: [] }, message: "I don't have any history on file for that number yet." };
  }
  // Oldest-first spoken recap of the meaningful steps.
  const ordered = [...entries].reverse();
  const recap = ordered.map((e) => e.summary || e.event_type).join("; ");
  return {
    ok: true,
    result: { entries: ordered },
    message: `Here's everything so far: ${recap}.`,
  };
}

function pickString(parameters: Record<string, unknown>, key: string): string | null {
  const value = parameters[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

let registered = false;
export function registerRelationshipHandlers(): void {
  if (registered) return;
  registerToolHandler("get_ledger", getLedgerHandler);
  registered = true;
}

export function __resetRegistrationForTests(): void {
  registered = false;
}
