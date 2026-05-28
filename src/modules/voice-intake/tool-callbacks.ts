import { Router, Request, Response } from "express";
import express from "express";
import { query } from "../../config/database";
import { logger } from "../../utils/logger";
import { stampTape } from "../tape";
import { verifySignature } from "./signature";

/**
 * ElevenLabs Conv. AI in-call server-tool receiver.
 *
 * SECURITY-CRITICAL: mount BEFORE `express.json()` in src/index.ts. Same raw-
 * body constraint as the post-call webhook — ElevenLabs computes HMAC over
 * the raw bytes prefixed with `<timestamp>.`.
 *
 * Contract (response shape the voice agent will read back to the caller):
 *   { ok: boolean, result?: object, message?: string }
 *
 * Status code policy:
 *   - 400 only for AUTH-layer failure (sig, replay, malformed body).
 *     ElevenLabs auto-disables the webhook after 10 consecutive non-2xx
 *     deliveries, so 4xx is reserved for "this request was unauthenticated"
 *     — a misbehaving handler still returns 200 with { ok: false } so the
 *     agent reads the message and the budget stays intact.
 *   - 503 when VOICE_TOOLS_ENABLED=false or secret is sentinel.
 *   - 200 with { ok: false, message } for unknown tool, idempotent replay,
 *     or any handler-level "no, can't do that" path.
 *   - 200 with { ok: true, result?, message? } on success.
 *
 * Idempotency: reuses elevenlabs_processed_events keyed on
 * `tool:<conversation_id>:<tool_call_id>`. ElevenLabs may retry the same
 * tool_call_id on transient network failure; the second arrival short-circuits
 * with the same response payload.
 *
 * Dispatch table is empty in Phase A. Each Phase B/D/E/F slice registers its
 * handler (send_app_link, lookup_tenant, file_maintenance_request,
 * file_compliance_report) by name. Until then every tool the agent fires gets
 * a 200 { ok: false, message: "Tool not yet implemented" } so we can land the
 * receiver in prod (dark) before any handler is wired.
 */

const ROUTE_PREFIX = "/api/webhooks/elevenlabs/tools";

interface ToolCallbackPayload {
  tool_call_id?: string;
  tool_name?: string;
  agent_id?: string;
  conversation_id?: string;
  parameters?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface ToolCallbackContext {
  agentId: string;
  conversationId: string;
  toolCallId: string;
  toolName: string;
}

export interface ToolCallbackResult {
  ok: boolean;
  result?: Record<string, unknown>;
  message?: string;
}

export type ToolHandler = (
  parameters: Record<string, unknown>,
  context: ToolCallbackContext
) => Promise<ToolCallbackResult>;

// Phase A ships an empty registry. Phase B adds `send_app_link`; Phases D/E/F
// add the rest. Exposed so the test suite can register fixtures.
const handlers = new Map<string, ToolHandler>();

export function registerToolHandler(name: string, handler: ToolHandler): void {
  handlers.set(name, handler);
}

export function clearToolHandlersForTests(): void {
  handlers.clear();
}

export function getRegisteredToolNames(): string[] {
  return Array.from(handlers.keys());
}

function buildToolEventId(conversationId: string, toolCallId: string): string {
  return `tool:${conversationId}:${toolCallId}`;
}

async function alreadyProcessed(eventId: string): Promise<boolean> {
  const result = await query(
    `SELECT 1 FROM elevenlabs_processed_events WHERE event_id = $1 LIMIT 1`,
    [eventId]
  );
  return result.rows.length > 0;
}

async function markProcessed(
  eventId: string,
  toolName: string,
  conversationId: string
): Promise<void> {
  await query(
    `INSERT INTO elevenlabs_processed_events (event_id, event_type, conversation_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (event_id) DO NOTHING`,
    [eventId, `tool:${toolName}`, conversationId]
  );
}

function parseBody(rawBody: Buffer): ToolCallbackPayload | null {
  try {
    const parsed = JSON.parse(rawBody.toString("utf8"));
    if (parsed && typeof parsed === "object") return parsed as ToolCallbackPayload;
    return null;
  } catch {
    return null;
  }
}

function validatePayload(
  toolNameFromUrl: string,
  body: ToolCallbackPayload
): { ok: true; ctx: ToolCallbackContext } | { ok: false; reason: string } {
  // tool_name in the URL is authoritative — the agent config wires each tool
  // to its own URL. We accept either presence or absence in the body, but if
  // the body carries one it must match (defense-in-depth against agent
  // misconfiguration).
  if (body.tool_name && body.tool_name !== toolNameFromUrl) {
    return { ok: false, reason: "tool-name-mismatch" };
  }
  if (!body.conversation_id) return { ok: false, reason: "missing-conversation-id" };
  if (!body.agent_id) return { ok: false, reason: "missing-agent-id" };
  if (!body.tool_call_id) return { ok: false, reason: "missing-tool-call-id" };

  return {
    ok: true,
    ctx: {
      agentId: body.agent_id,
      conversationId: body.conversation_id,
      toolCallId: body.tool_call_id,
      toolName: toolNameFromUrl,
    },
  };
}

const router = Router();

router.post(
  "/:tool_name",
  express.raw({ type: "application/json", limit: "2mb" }),
  async (req: Request, res: Response): Promise<void> => {
    if (process.env.VOICE_TOOLS_ENABLED !== "true") {
      res.status(503).json({ ok: false, message: "Voice tools disabled" });
      return;
    }

    const secret = process.env.ELEVENLABS_WEBHOOK_SECRET ?? "";
    if (!secret || secret === "wsec_changeme") {
      res.status(503).json({ ok: false, message: "Webhook secret not configured" });
      return;
    }

    const toolNameParam = req.params.tool_name;
    const toolName = Array.isArray(toolNameParam)
      ? String(toolNameParam[0] ?? "")
      : String(toolNameParam ?? "");
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
    const sigHeader = req.headers["elevenlabs-signature"];
    const nowSecs = Math.floor(Date.now() / 1000);

    const sigResult = verifySignature(rawBody, sigHeader, secret, nowSecs);
    if (!sigResult.ok) {
      logger.warn("Voice tool callback rejected", {
        toolName,
        reason: sigResult.reason,
      });
      res.status(400).json({ ok: false, message: "Invalid signature" });
      return;
    }

    const body = parseBody(rawBody);
    if (!body) {
      logger.warn("Voice tool callback rejected", { toolName, reason: "invalid-json" });
      res.status(400).json({ ok: false, message: "Invalid body" });
      return;
    }

    const validated = validatePayload(toolName, body);
    if (!validated.ok) {
      logger.warn("Voice tool callback rejected", {
        toolName,
        reason: validated.reason,
      });
      res.status(400).json({ ok: false, message: "Invalid payload" });
      return;
    }

    const ctx = validated.ctx;
    const eventId = buildToolEventId(ctx.conversationId, ctx.toolCallId);

    if (await alreadyProcessed(eventId)) {
      logger.info("Voice tool callback duplicate short-circuited", {
        eventId,
        toolName,
      });
      // Soft-200 so ElevenLabs doesn't retry. The agent's prompt should be
      // resilient to a duplicate-suppressed call (e.g., it just keeps going).
      res.status(200).json({
        ok: true,
        message: "Already processed",
        result: { duplicate: true },
      });
      return;
    }

    const handler = handlers.get(toolName);
    if (!handler) {
      // 200 (not 4xx) on purpose — see status-code policy in the header. The
      // agent's prompt will hear "Tool not yet implemented" and apologize to
      // the caller; ElevenLabs' auto-disable budget stays intact.
      logger.warn("Voice tool callback unknown tool", {
        toolName,
        conversationId: ctx.conversationId,
      });
      void stampTape({
        kind: "VOICE_TOOL_INVOKED",
        actor: "elevenlabs-tool-callback",
        sessionId: ctx.conversationId,
        payload: {
          toolName,
          toolCallId: ctx.toolCallId,
          agentId: ctx.agentId,
          conversationId: ctx.conversationId,
          ok: false,
          reason: "unknown-tool",
        },
      });
      res.status(200).json({
        ok: false,
        message: "Tool not yet implemented",
      });
      return;
    }

    let handlerResult: ToolCallbackResult;
    try {
      handlerResult = await handler(body.parameters ?? {}, ctx);
    } catch (err) {
      const errMsg = (err as Error).message;
      logger.error("Voice tool callback handler threw", {
        toolName,
        conversationId: ctx.conversationId,
        error: errMsg,
      });
      void stampTape({
        kind: "VOICE_TOOL_INVOKED",
        actor: "elevenlabs-tool-callback",
        sessionId: ctx.conversationId,
        payload: {
          toolName,
          toolCallId: ctx.toolCallId,
          agentId: ctx.agentId,
          conversationId: ctx.conversationId,
          ok: false,
          reason: "handler-threw",
          error: errMsg,
        },
      });
      // Soft-fail — do NOT mark the event processed so a manual retry or
      // operator action can re-deliver if needed.
      res.status(200).json({
        ok: false,
        message: "Sorry, something went wrong on our end.",
      });
      return;
    }

    void stampTape({
      kind: "VOICE_TOOL_INVOKED",
      actor: "elevenlabs-tool-callback",
      sessionId: ctx.conversationId,
      payload: {
        toolName,
        toolCallId: ctx.toolCallId,
        agentId: ctx.agentId,
        conversationId: ctx.conversationId,
        ok: handlerResult.ok,
      },
    });

    await markProcessed(eventId, toolName, ctx.conversationId);

    res.status(200).json(handlerResult);
  }
);

export default router;
export const TOOL_CALLBACK_ROUTE_PREFIX = ROUTE_PREFIX;

// Exposed for the Jest harness so the test can dispatch parsed bodies without
// reimplementing the validation pipeline.
export const __test = {
  buildToolEventId,
  parseBody,
  validatePayload,
};
