/**
 * telegram.ts — minimal Telegram Bot API client for the hosted Deal-Room bot.
 *
 * Port of the tg() / reply_long() / notify_operator() helpers in
 * battlestation daemons/dealroom-telegram.py (231-343). Uses Node's global
 * `fetch` (no SDK / new dep). Every call is best-effort and never throws — a
 * failed send must not break the request the partner is waiting on, and a failed
 * operator alert must not break the answer.
 */
import { logger } from "../../utils/logger";

const TG_MAX = 3500; // stay under Telegram's ~4096-char message limit

function botToken(): string {
  return process.env.DEAL_TELEGRAM_BOT_TOKEN || "";
}

async function tgCall(method: string, params: Record<string, unknown>): Promise<boolean> {
  const token = botToken();
  if (!token) {
    logger.warn("deal-qa telegram: no bot token configured", { method });
    return false;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean };
    return body?.ok === true;
  } catch (e) {
    logger.warn("deal-qa telegram api call failed", {
      method,
      error: (e as Error)?.message,
    });
    return false;
  }
}

export async function sendMessage(chatId: string | number, text: string): Promise<boolean> {
  return tgCall("sendMessage", { chat_id: String(chatId), text });
}

/** Best-effort "typing…" indicator during retrieval. */
export async function sendTyping(chatId: string | number): Promise<void> {
  await tgCall("sendChatAction", { chat_id: String(chatId), action: "typing" });
}

/**
 * Send a long answer in Telegram-sized chunks, split on line boundaries so
 * citations aren't cut mid-line (port of reply_long, daemon:315-330).
 */
export async function replyLong(chatId: string | number, text: string): Promise<void> {
  if (text.length <= TG_MAX) {
    await sendMessage(chatId, text);
    return;
  }
  let chunk = "";
  for (const line of text.split("\n")) {
    if (chunk.length + line.length + 1 > TG_MAX && chunk) {
      await sendMessage(chatId, chunk);
      chunk = "";
    }
    chunk += line + "\n";
  }
  if (chunk.trim()) await sendMessage(chatId, chunk);
}

/**
 * Passive operator ping via THIS bot's token (port of notify_operator,
 * daemon:333-343). Requires the operator to have DM'd the bot once; silent
 * no-op if DEAL_QA_OPERATOR_CHAT_ID is unset. Never throws.
 */
export async function notifyOperator(text: string): Promise<void> {
  const chat = process.env.DEAL_QA_OPERATOR_CHAT_ID || "";
  logger.info("deal-qa operator alert", { text });
  if (!chat) return;
  try {
    await sendMessage(chat, text);
  } catch {
    /* best-effort */
  }
}
