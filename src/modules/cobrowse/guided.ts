import crypto from "crypto";
import { query } from "../../config/database";
import { logger } from "../../utils/logger";
import { stampTape } from "../tape";
import {
  type ToolCallbackContext,
  type ToolCallbackResult,
} from "../voice-intake/tool-callbacks";
import { composeGuidedStatus, isGuidedStep } from "./runtime/coaching";

/**
 * Concierge co-browse — Tier 1 "guided co-pilot" runtime.
 *
 * The SAFE half of the co-browse vision: Frank coaches the applicant through
 * their OWN /apply wizard by voice, in sync, while THEY do every action. No
 * browser is driven, nothing is submitted on their behalf, so this never
 * touches the counsel-gated orchestrator (runtime/orchestrator.ts stays dark).
 *
 * Two seams:
 *   1) recordGuidedStep — the applicant's browser POSTs which wizard step it's
 *      on (step key only, never values). HTTP route in routes.ts. Token-gated.
 *   2) cobrowseStatusHandler — the `cobrowse_status` voice tool. Frank calls it
 *      to learn where the applicant is + read back the coaching for that step.
 *
 * Independent gate: COBROWSE_GUIDED_ENABLED (NOT the orchestrator's
 * COBROWSE_ENABLED). Fail-closed by default.
 */

export function guidedEnabled(): boolean {
  return process.env.COBROWSE_GUIDED_ENABLED === "true";
}

function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function pickString(parameters: Record<string, unknown>, key: string): string | null {
  const value = parameters[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export type RecordStepResult =
  | { ok: true; state: string; currentStep: string; stepsReached: number }
  | { ok: false; code: 503 | 400 | 404 | 410 | 500; error: string };

/**
 * Record the wizard step the applicant's browser is currently on. Auth is the
 * raw viewer token (`vt`) minted by start_cobrowse — we match its sha256 to the
 * session's viewer_token_hash and require it unexpired. We deliberately do NOT
 * enforce single-use here (the token already gated the initial /view; step
 * reports recur for the life of the guided session). No field VALUES are
 * accepted — only the step key, keeping the table PII-minimal.
 */
export async function recordGuidedStep(args: {
  sessionId: string;
  rawToken: string | null;
  stepKey: string | null;
}): Promise<RecordStepResult> {
  if (!guidedEnabled()) {
    return { ok: false, code: 503, error: "cobrowse_guided_disabled" };
  }

  const { sessionId, rawToken, stepKey } = args;
  if (!sessionId || !rawToken) {
    return { ok: false, code: 400, error: "missing_token" };
  }
  if (!isGuidedStep(stepKey)) {
    // Unknown / non-guided step keys are rejected rather than silently stored —
    // the coaching map is the source of truth for valid steps.
    return { ok: false, code: 400, error: "unknown_step" };
  }

  const tokenHash = hashToken(rawToken);

  let row: { id: string; state: string; expires_at: string; guided_started_at: string | null } | undefined;
  try {
    const result = await query(
      `SELECT id, state, expires_at, guided_started_at
         FROM cobrowse_sessions
        WHERE id = $1 AND viewer_token_hash = $2
        LIMIT 1`,
      [sessionId, tokenHash]
    );
    row = result.rows[0];
  } catch (err) {
    logger.error("cobrowse guided step lookup failed", {
      sessionId,
      error: (err as Error).message,
    });
    return { ok: false, code: 500, error: "internal_error" };
  }

  if (!row) {
    // Don't distinguish "no session" from "wrong token" — both are 404.
    return { ok: false, code: 404, error: "not_found" };
  }
  if (new Date(row.expires_at) < new Date()) {
    return { ok: false, code: 410, error: "expired" };
  }

  const firstReport = !row.guided_started_at;

  let updated: { state: string; current_step: string; steps_reached: number } | undefined;
  try {
    const res = await query(
      `UPDATE cobrowse_sessions
          SET current_step = $2,
              steps_reached = steps_reached + 1,
              last_step_at = NOW(),
              guided_started_at = COALESCE(guided_started_at, NOW()),
              updated_at = NOW()
        WHERE id = $1
      RETURNING state, current_step, steps_reached`,
      [sessionId, stepKey]
    );
    updated = res.rows[0];
  } catch (err) {
    logger.error("cobrowse guided step update failed", {
      sessionId,
      error: (err as Error).message,
    });
    return { ok: false, code: 500, error: "internal_error" };
  }

  if (firstReport) {
    await stampTape({
      kind: "COBROWSE_GUIDED_STARTED",
      actor: "cobrowse-guided",
      sessionId,
      payload: { sessionId, firstStep: stepKey },
    });
  }
  await stampTape({
    kind: "COBROWSE_STEP_REACHED",
    actor: "cobrowse-guided",
    sessionId,
    payload: { sessionId, step: stepKey },
  });

  logger.info("cobrowse guided step recorded", { sessionId, step: stepKey });

  return {
    ok: true,
    state: updated?.state ?? row.state,
    currentStep: updated?.current_step ?? stepKey,
    stepsReached: updated?.steps_reached ?? 1,
  };
}

/**
 * `cobrowse_status` voice tool. Frank calls this (by `session_id`) to learn
 * which step the applicant is on and get the coaching to narrate next. The
 * `message` is the spoken coaching so the agent can read it back directly; the
 * `result` carries the structured status (incl. `applicantMustDo`, so the agent
 * keeps to the legal line on the sensitive steps).
 */
export async function cobrowseStatusHandler(
  parameters: Record<string, unknown>,
  context: ToolCallbackContext
): Promise<ToolCallbackResult> {
  if (!guidedEnabled()) {
    logger.warn("cobrowse_status denied — guided disabled", {
      conversationId: context.conversationId,
    });
    return {
      ok: false,
      message: "I can't see your screen right now — let's keep going step by step out loud.",
    };
  }

  const sessionId = pickString(parameters, "session_id");
  if (!sessionId) {
    return {
      ok: false,
      message: "I lost track of which application we were filling out — can you reopen the link I texted?",
    };
  }

  let row: { state: string; current_step: string | null } | undefined;
  try {
    const res = await query(
      `SELECT state, current_step
         FROM cobrowse_sessions
        WHERE id = $1 AND conversation_id = $2
        LIMIT 1`,
      [sessionId, context.conversationId]
    );
    row = res.rows[0];
  } catch (err) {
    logger.error("cobrowse_status lookup failed", {
      conversationId: context.conversationId,
      sessionId,
      error: (err as Error).message,
    });
    return { ok: false, message: "Sorry, I'm having trouble seeing where you are. Tell me which step you're on." };
  }

  if (!row) {
    return {
      ok: false,
      message: "I couldn't find our session. Reopen the link I texted you and we'll pick right back up.",
    };
  }

  const status = composeGuidedStatus(row.state, row.current_step);

  if (!status.currentStep) {
    return {
      ok: true,
      result: status,
      message: "Open the link I just texted you and tell me when the application loads — then we'll go field by field.",
    };
  }

  return {
    ok: true,
    result: status,
    message: status.coaching ?? "Let's keep going — tell me which field you're on.",
  };
}
