import { query } from "../../config/database";
import { logger } from "../../utils/logger";
import { stampTape } from "../tape";
import {
  type ToolCallbackContext,
  type ToolCallbackResult,
} from "../voice-intake/tool-callbacks";

/**
 * Phase 2 in-call tool: `confirm_cobrowse` (DARK scaffold).
 *
 * The applicant has watched Frank fill the wizard in the live viewer and says
 * "yes, submit it." The agent fires this tool with
 * `{ session_id }` (the cobrowse_sessions.id minted by start_cobrowse). We
 * stamp the confirmation, set confirmed_at + state='confirmed', and return.
 *
 * FAIL-CLOSED: gated behind COBROWSE_ENABLED, and the actual wizard submission
 * is NOT performed here (the orchestrator is a stub). This handler only records
 * the applicant's affirmative final consent — the audit anchor that makes any
 * eventual autonomous submission defensible.
 *
 * VOICE_TOOL_INVOKED is stamped by the parent dispatcher; we do not double it.
 */

export async function confirmCobrowseHandler(
  parameters: Record<string, unknown>,
  context: ToolCallbackContext
): Promise<ToolCallbackResult> {
  if (process.env.COBROWSE_ENABLED !== "true") {
    logger.warn("confirm_cobrowse denied — feature disabled", {
      conversationId: context.conversationId,
    });
    return {
      ok: false,
      message: "I can't confirm that right now.",
    };
  }

  const sessionId = pickString(parameters, "session_id");
  if (!sessionId) {
    logger.warn("confirm_cobrowse missing session_id", {
      conversationId: context.conversationId,
    });
    return {
      ok: false,
      message: "I lost track of which application we were filling out — can you start over?",
    };
  }

  let updated: { id: string } | null = null;
  try {
    const res = await query(
      `UPDATE cobrowse_sessions
          SET confirmed_at = NOW(),
              state = 'confirmed',
              updated_at = NOW()
        WHERE id = $1
          AND conversation_id = $2
          AND state NOT IN ('denied','expired','aborted','error')
      RETURNING id`,
      [sessionId, context.conversationId]
    );
    updated = res.rows.length > 0 ? { id: String(res.rows[0].id) } : null;
  } catch (err) {
    logger.error("confirm_cobrowse update failed", {
      conversationId: context.conversationId,
      sessionId,
      error: (err as Error).message,
    });
    return {
      ok: false,
      message: "Sorry, something went wrong confirming that. Could you try again?",
    };
  }

  if (!updated) {
    logger.warn("confirm_cobrowse no matching active session", {
      conversationId: context.conversationId,
      sessionId,
    });
    return {
      ok: false,
      message: "I couldn't find an active session to confirm.",
    };
  }

  await stampTape({
    kind: "COBROWSE_CONFIRMED",
    actor: "cobrowse-confirm",
    sessionId: updated.id,
    payload: {
      sessionId: updated.id,
      conversationId: context.conversationId,
    },
  });

  logger.info("confirm_cobrowse confirmed", {
    conversationId: context.conversationId,
    sessionId: updated.id,
  });

  return {
    ok: true,
    result: { sessionId: updated.id, confirmed: true },
    message: "Got it — you've confirmed. Thank you!",
  };
}

function pickString(parameters: Record<string, unknown>, key: string): string | null {
  const value = parameters[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
