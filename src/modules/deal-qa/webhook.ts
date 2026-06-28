/**
 * webhook.ts — Telegram webhook receiver for the hosted Deal-Room Q&A bot.
 *
 * Replaces the local launchd long-poll (dealroom-telegram.py getUpdates loop)
 * with a hosted push endpoint: POST /api/webhooks/telegram/deal. Mounted in
 * src/index.ts BEFORE the global express.json() (it carries its own parser),
 * next to the other webhook receivers.
 *
 * NEVER 5xx — Telegram disables a webhook after repeated non-2xx. The handler
 * validates, acks 200 immediately, then grounds + replies ASYNCHRONOUSLY. Auth is
 * a static secret token (set at setWebhook time), compared timing-safe; the
 * sentinel value fails closed (503). Dark by default: DEAL_QA_ENABLED!=="true"
 * acks 200 and ignores the update.
 *
 * Dispatch mirrors dealroom-telegram.py handle_message (398-429): not-enrolled →
 * greet-once + operator ping; /start|/help → welcome; smalltalk → nudge;
 * /ask <q> or plain text → grounded, masked, cited answer at the effective tier.
 */
import express, { Router, Request, Response } from "express";
import crypto from "crypto";
import { logger } from "../../utils/logger";
import { resolveEnrollment } from "./enrollment";
import { effectiveTier, type DealTier } from "./compartment-guard";
import { groundAnswer } from "./service";
import { sendMessage, sendTyping, replyLong, notifyOperator } from "./telegram";

// Clean, partner-facing copy (never the internal Mr. B / SAGE framing; a generic
// error so a raw exception never leaks to an outside partner).
const COPY = {
  welcome:
    "📂 Welcome to the Deal Room assistant.\n" +
    "Ask me anything about the deal and I'll answer from the deal materials, with sources.\n\n" +
    "  /ask <question>   grounded, cited answer\n" +
    "  (or just type your question)",
  stranger:
    "👋 This is the Deal Room assistant. You're not on the access list yet, so I " +
    "can't answer just now — I've let the team know you reached out. Once you're granted " +
    "access, ask me again.",
  smalltalk:
    "📂 Hi! Ask me anything about the deal and I'll answer from the materials, with " +
    'sources — e.g. "What\'s the structure of the token?" or "How do the §48E and ' +
    '§30C credits stack?"',
  empty:
    "📂 Good question — I don't have that in the deal materials yet. I've flagged it for the team.",
  offline: "📂 Sorry, I couldn't get that just now — the team has been notified.",
  scopedFooter: "\n\n🔒 Some details are scoped out on this channel.",
};

// Bare greetings shouldn't fire a corpus query (or a boundary-hit ping).
const SMALLTALK = new Set([
  "hi", "hello", "hey", "yo", "gm", "good morning", "good evening", "thanks",
  "thank you", "ty", "ok", "okay", "cool", "great", "nice", "got it", "hi there",
  "hello there", "sup", "hiya",
]);

interface TgUpdate {
  update_id?: number;
  message?: {
    chat?: { id?: number | string };
    from?: { first_name?: string; last_name?: string; username?: string };
    text?: string;
  };
}

// In-memory dedup + first-contact tracking (test cut; the production version uses
// a table). Bounded so a long-lived process can't grow them without limit.
const seenUpdates = new Set<number>();
const strangerSeen = new Set<string>();

// The channel floor: every answer masks at LEAST this tier. Refuses "internal" as
// a floor (that would disable masking) — always at least privileged.
function floorTier(): DealTier {
  const f = (process.env.DEAL_QA_FLOOR_TIER || "privileged").trim();
  return f === "privileged" || f === "ext-named" || f === "ext-generic"
    ? f
    : "privileged";
}

function secretCheck(provided: string | undefined): "ok" | "sentinel" | "bad" {
  const secret = process.env.DEAL_TELEGRAM_WEBHOOK_SECRET ?? "";
  if (!secret || secret === "tgsec_changeme") return "sentinel";
  const got = provided ?? "";
  if (got.length !== secret.length) return "bad";
  try {
    return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(secret)) ? "ok" : "bad";
  } catch {
    return "bad";
  }
}

function fromName(msg: NonNullable<TgUpdate["message"]>): string {
  const u = msg.from || {};
  return (
    [u.first_name, u.last_name].filter(Boolean).join(" ") || u.username || "someone"
  );
}

async function doAsk(
  chatId: number | string,
  who: string,
  question: string,
  chatTier: DealTier
): Promise<void> {
  const eff = effectiveTier(chatTier, floorTier());
  await sendTyping(chatId);

  let r;
  try {
    r = groundAnswer(question, eff);
  } catch (e) {
    logger.error("deal-qa grounding failed", { error: (e as Error)?.message });
    await sendMessage(chatId, COPY.offline);
    await notifyOperator(`⚠️ Deal Room error for ${who}: ${(e as Error)?.message}`);
    return;
  }

  if (!r.ok) {
    await sendMessage(chatId, COPY.offline);
    return;
  }
  if (r.empty) {
    await sendMessage(chatId, COPY.empty);
    return;
  }

  let answer = r.answer || "";
  answer += `\n\n— grounded in ${r.nSources} source(s).`;
  if (r.withheld) answer += COPY.scopedFooter;
  await replyLong(chatId, answer);

  if (r.withheld) {
    await notifyOperator(
      `🔒 ${who} (${eff}) hit the compartment boundary (masked: ` +
        `${(r.maskedClasses || []).join(", ")}). Q: ${question.slice(0, 200)}`
    );
  }
}

async function processUpdate(update: TgUpdate): Promise<void> {
  const msg = update?.message;
  if (!msg || typeof msg !== "object") return;
  const chatId = msg.chat?.id;
  if (chatId === undefined || chatId === null) return;
  const text = typeof msg.text === "string" ? msg.text.trim() : "";
  const who = fromName(msg);

  // Enrollment gate (fail-closed): an unknown chat is never answered.
  const enr = resolveEnrollment(chatId);
  if (!enr.enrolled) {
    const key = String(chatId);
    if (!strangerSeen.has(key)) {
      if (strangerSeen.size > 4000) strangerSeen.clear();
      strangerSeen.add(key);
      await sendMessage(chatId, COPY.stranger);
      await notifyOperator(
        `👋 New Deal Room contact: ${who} (chat ${chatId}). To grant access, add ` +
          `"${chatId}:privileged" to DEAL_QA_ALLOWLIST and redeploy.`
      );
    }
    return;
  }

  const lower = text.toLowerCase();
  if (!text || lower === "/start" || lower === "/help") {
    await sendMessage(chatId, COPY.welcome);
    return;
  }

  let question = text;
  if (lower.startsWith("/ask")) {
    question = text.slice(4).trim();
    if (!question) {
      await sendMessage(chatId, COPY.welcome);
      return;
    }
  } else if (text.startsWith("/")) {
    // Unknown slash command → welcome (no corpus hit).
    await sendMessage(chatId, COPY.welcome);
    return;
  } else if (SMALLTALK.has(lower)) {
    await sendMessage(chatId, COPY.smalltalk);
    return;
  }

  await doAsk(chatId, who, question, enr.tier);
}

const router = Router();

router.post(
  "/deal",
  express.json({ limit: "512kb" }),
  (req: Request, res: Response): void => {
    // 1. Dark by default — ack 200 (never 5xx) and ignore until enabled.
    if (process.env.DEAL_QA_ENABLED !== "true") {
      res.sendStatus(200);
      return;
    }

    // 2. Static secret-token verification (set at setWebhook time).
    const check = secretCheck(
      req.header("X-Telegram-Bot-Api-Secret-Token") || undefined
    );
    if (check === "sentinel") {
      res.status(503).json({ error: "Webhook secret not configured" });
      return;
    }
    if (check === "bad") {
      // Only a non-Telegram caller lands here — Telegram always sends the secret.
      res.sendStatus(401);
      return;
    }

    // 3. Parse + dedup (Telegram redelivers on timeout).
    const update = (req.body || {}) as TgUpdate;
    const updateId = typeof update.update_id === "number" ? update.update_id : null;
    if (updateId !== null) {
      if (seenUpdates.has(updateId)) {
        res.sendStatus(200);
        return;
      }
      if (seenUpdates.size > 8000) seenUpdates.clear();
      seenUpdates.add(updateId);
    }

    // 4. Ack immediately, then ground + reply async. The answer is delivered via
    //    sendMessage, not the HTTP response — keeps us under Telegram's timeout.
    res.sendStatus(200);
    void processUpdate(update).catch((e) =>
      logger.error("deal-qa processUpdate failed", { error: (e as Error)?.message })
    );
  }
);

export default router;

// Exposed for the test harness — exercise dispatch/secret/floor without Express.
export const __test = { secretCheck, floorTier, processUpdate, SMALLTALK };
