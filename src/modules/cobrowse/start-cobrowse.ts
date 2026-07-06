import crypto from "crypto";
import { query } from "../../config/database";
import { logger } from "../../utils/logger";
import { sendMagicLinkSms } from "../auth/magic-link-service";
import { stampTape } from "../tape";
import {
  registerToolHandler,
  type ToolCallbackContext,
  type ToolCallbackResult,
} from "../voice-intake/tool-callbacks";

/**
 * Phase 2 in-call tool: `start_cobrowse` (DARK scaffold).
 *
 * Mid-call Frank offers: "want me to fill out the application *with* you — I'll
 * text you a link where you can watch me do it and confirm before anything's
 * submitted?" If the caller affirmatively consents, the agent fires this tool
 * with `{ cobrowse_consent: true, phone?, application_id?, agent_model? }`.
 *
 * FAIL-CLOSED. Two independent gates, both deny → 503-equivalent
 * ({ ok: false }) so nothing is reachable until the operator opts in AND the
 * caller consents:
 *   1) COBROWSE_ENABLED !== 'true'  → deny (feature dark)
 *   2) cobrowse_consent not truthy  → deny (no affirmative consent captured)
 *
 * On the happy path we:
 *   - find-or-create a draft application for the caller's user,
 *   - mint a one-time viewer token (sha256 at rest, mirrors
 *     auth/magic-link-service.ts),
 *   - INSERT a cobrowse_sessions row (state='created', consent_captured_at=now),
 *   - SMS the viewer link via the sendMagicLinkSms transport,
 *   - stamp COBROWSE_CONSENT_CAPTURED + COBROWSE_SESSION_STARTED.
 *
 * The live driving loop is NOT started here — the orchestrator is a stub. This
 * handler only establishes the consented, audited session + viewer link.
 *
 * The parent dispatcher (tool-callbacks.ts) already emits VOICE_TOOL_INVOKED
 * with the ok/handler outcome. We do NOT double-stamp that.
 */

const TOKEN_TTL_MINUTES = 15;

function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function pickString(parameters: Record<string, unknown>, key: string): string | null {
  const value = parameters[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function isConsentGiven(parameters: Record<string, unknown>): boolean {
  const raw = parameters["cobrowse_consent"];
  if (raw === true) return true;
  if (typeof raw === "string") {
    const v = raw.trim().toLowerCase();
    return v === "true" || v === "yes" || v === "1";
  }
  return false;
}

export async function startCobrowseHandler(
  parameters: Record<string, unknown>,
  context: ToolCallbackContext
): Promise<ToolCallbackResult> {
  // GATE 1 — feature flag. Fail closed.
  if (process.env.COBROWSE_ENABLED !== "true") {
    logger.warn("start_cobrowse denied — feature disabled", {
      conversationId: context.conversationId,
    });
    await stampDeny(context, "feature_disabled");
    return {
      ok: false,
      message:
        "I'm not able to fill the application out with you just yet. I can text you a link to do it yourself instead.",
    };
  }

  // GATE 2 — explicit consent. Fail closed.
  if (!isConsentGiven(parameters)) {
    logger.warn("start_cobrowse denied — no consent", {
      conversationId: context.conversationId,
    });
    await stampDeny(context, "no_consent");
    return {
      ok: false,
      message:
        "No problem — I won't fill anything out without your OK. Just say the word if you change your mind.",
    };
  }

  const agentModel = pickString(parameters, "agent_model");
  const applicationIdParam = pickString(parameters, "application_id");

  // Resolve the applicant user + a draft application to co-browse.
  let resolved: { userId: string; applicationId: string };
  try {
    resolved = await findOrCreateDraft({
      conversationId: context.conversationId,
      applicationId: applicationIdParam,
    });
  } catch (err) {
    logger.error("start_cobrowse find-or-create draft failed", {
      conversationId: context.conversationId,
      error: (err as Error).message,
    });
    await stampDeny(context, "draft_resolution_failed");
    return {
      ok: false,
      message:
        "Sorry, I'm having trouble setting that up right now. Could you try again in a moment?",
    };
  }

  // Mint a one-time viewer token (raw only in the SMS; sha256 at rest).
  const rawToken = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000);

  let sessionId: string;
  try {
    const inserted = await query(
      `INSERT INTO cobrowse_sessions
         (conversation_id, application_id, user_id, viewer_token_hash,
          expires_at, state, agent_model, consent_captured_at)
       VALUES ($1, $2, $3, $4, $5, 'created', $6, NOW())
       RETURNING id`,
      [
        context.conversationId,
        resolved.applicationId,
        resolved.userId,
        tokenHash,
        expiresAt,
        agentModel,
      ]
    );
    sessionId = String(inserted.rows[0].id);
  } catch (err) {
    logger.error("start_cobrowse session insert failed", {
      conversationId: context.conversationId,
      error: (err as Error).message,
    });
    await stampDeny(context, "session_insert_failed");
    return {
      ok: false,
      message:
        "Sorry, I'm having trouble setting that up right now. Could you try again in a moment?",
    };
  }

  // Consent is the durable, citeable moment — stamp it before anything else.
  await stampTape({
    kind: "COBROWSE_CONSENT_CAPTURED",
    actor: "cobrowse-start",
    sessionId: context.conversationId,
    payload: {
      sessionId,
      conversationId: context.conversationId,
      applicationId: resolved.applicationId,
    },
  });

  // Text the viewer link. Reuses the magic-link SMS transport (resolves phone
  // from the user id of record). Raw token rides only in this link.
  const viewerLink = buildViewerLink(sessionId, rawToken);
  sendMagicLinkSms(resolved.userId, viewerLink);

  await stampTape({
    kind: "COBROWSE_SESSION_STARTED",
    actor: "cobrowse-start",
    sessionId,
    payload: {
      sessionId,
      conversationId: context.conversationId,
      applicationId: resolved.applicationId,
      agentModel: agentModel ?? null,
    },
  });

  logger.info("start_cobrowse session created", {
    conversationId: context.conversationId,
    sessionId,
  });

  return {
    ok: true,
    result: { sessionId },
    message:
      "Perfect — I just texted you a link. Open it and you'll see me filling out the form. I'll pause for your OK before anything is submitted.",
  };
}

function buildViewerLink(sessionId: string, rawToken: string): string {
  const portalBase = process.env.TENANT_PORTAL_URL || "http://localhost:5174";
  return `${portalBase}/cobrowse/${encodeURIComponent(sessionId)}?vt=${rawToken}`;
}

async function stampDeny(
  context: ToolCallbackContext,
  reason: string
): Promise<void> {
  await stampTape({
    kind: "COBROWSE_DENIED",
    actor: "cobrowse-start",
    sessionId: context.conversationId,
    payload: { conversationId: context.conversationId, reason },
  });
}

interface FindOrCreateDraftArgs {
  conversationId: string;
  applicationId: string | null;
}

/**
 * Resolve the (draft) application this co-browse drives, plus its owning user.
 *
 * If the agent passed an application_id, we trust it (it came through the
 * signed tool-callback pipeline). Otherwise we look up the most recent draft
 * application linked to the synthesized voice user for this conversation —
 * matching the find-or-create email convention used by send-app-link.ts so a
 * caller who already has a draft from the same call gets co-browsed onto it.
 */
async function findOrCreateDraft(
  args: FindOrCreateDraftArgs
): Promise<{ userId: string; applicationId: string }> {
  if (args.applicationId) {
    // Ownership lives in the user_applications join (relationship='primary'),
    // not on applications directly — mirrors applicants/routes.ts. Prefer the
    // primary applicant when an application has co-applicants/household members.
    const res = await query(
      `SELECT ua.application_id AS id, ua.user_id
         FROM user_applications ua
        WHERE ua.application_id = $1
        ORDER BY (ua.relationship = 'primary') DESC, ua.created_at ASC
        LIMIT 1`,
      [args.applicationId]
    );
    if (res.rows.length > 0) {
      const row = res.rows[0];
      return { userId: String(row.user_id), applicationId: String(row.id) };
    }
  }

  const email = synthEmailFromConversation(args.conversationId);
  const userRes = await query(
    `SELECT id FROM users WHERE email = $1 LIMIT 1`,
    [email]
  );
  if (userRes.rows.length === 0) {
    throw new Error("no applicant user for this conversation");
  }
  const userId = String(userRes.rows[0].id);

  const draftRes = await query(
    `SELECT a.id
       FROM user_applications ua
       JOIN applications a ON a.id = ua.application_id
      WHERE ua.user_id = $1
      ORDER BY a.created_at DESC
      LIMIT 1`,
    [userId]
  );
  if (draftRes.rows.length === 0) {
    throw new Error("no draft application for this applicant");
  }

  return { userId, applicationId: String(draftRes.rows[0].id) };
}

function synthEmailFromConversation(conversationId: string): string {
  const slug = conversationId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "anon";
  return `voice+${slug}@voice-handoff.invalid`;
}

let registered = false;
/**
 * Idempotent registration helper. Boot calls this once; tests can also call
 * it after clearToolHandlersForTests() to re-wire.
 */
export function registerCobrowseHandlers(): void {
  if (registered) return;
  registerToolHandler("start_cobrowse", startCobrowseHandler);
  registerToolHandler("confirm_cobrowse", confirmCobrowseHandlerProxy);
  registerToolHandler("cobrowse_status", cobrowseStatusHandlerProxy);
  registered = true;
}

/** Test-only: reset the one-time gate so jest can re-register fresh. */
export function __resetRegistrationForTests(): void {
  registered = false;
}

// Lazy import avoids a circular module-load between the two handler files at
// require time (confirm-cobrowse imports nothing from here, but the registry
// wiring is centralized here for a single registerCobrowseHandlers entrypoint).
async function confirmCobrowseHandlerProxy(
  parameters: Record<string, unknown>,
  context: ToolCallbackContext
): Promise<ToolCallbackResult> {
  const { confirmCobrowseHandler } = await import("./confirm-cobrowse");
  return confirmCobrowseHandler(parameters, context);
}

// Tier 1 guided co-pilot: Frank's `cobrowse_status` read-back tool. Lazy import
// keeps the guided runtime out of the require graph until a call dispatches it.
async function cobrowseStatusHandlerProxy(
  parameters: Record<string, unknown>,
  context: ToolCallbackContext
): Promise<ToolCallbackResult> {
  const { cobrowseStatusHandler } = await import("./guided");
  return cobrowseStatusHandler(parameters, context);
}
