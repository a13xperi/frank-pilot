#!/usr/bin/env node
/**
 * set-deal-telegram-webhook.mjs — register (or remove) the Telegram webhook for
 * the hosted Deal-Room bot. Run ONCE after the first deploy, and again whenever
 * the Railway domain changes.
 *
 * Reminder: setWebhook DISABLES getUpdates on that token — use a dedicated bot,
 * never the live local @frank_deal_docs_bot.
 *
 * Env:  DEAL_TELEGRAM_BOT_TOKEN, DEAL_TELEGRAM_WEBHOOK_SECRET, [DEAL_WEBHOOK_URL]
 * Usage:
 *   node scripts/set-deal-telegram-webhook.mjs https://<railway-domain>
 *   DEAL_WEBHOOK_URL=https://<railway-domain> node scripts/set-deal-telegram-webhook.mjs
 *   node scripts/set-deal-telegram-webhook.mjs --delete        # rollback
 */
const token = process.env.DEAL_TELEGRAM_BOT_TOKEN;
const secret = process.env.DEAL_TELEGRAM_WEBHOOK_SECRET;
const args = process.argv.slice(2);
const del = args.includes("--delete");

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

async function tg(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  return res.json();
}

// Accept a base domain or a full URL; normalize to POST /api/webhooks/telegram/deal.
function resolveUrl(u) {
  if (!u) return null;
  u = u.replace(/\/+$/, "");
  return u.endsWith("/api/webhooks/telegram/deal")
    ? u
    : `${u}/api/webhooks/telegram/deal`;
}

if (!token) fail("Set DEAL_TELEGRAM_BOT_TOKEN (the dedicated bot's token).");

if (del) {
  const r = await tg("deleteWebhook", { drop_pending_updates: true });
  console.log("deleteWebhook →", JSON.stringify(r));
  process.exit(r.ok ? 0 : 1);
}

const url = resolveUrl(args.find((a) => a.startsWith("http")) || process.env.DEAL_WEBHOOK_URL);
if (!url) fail("Pass the Railway URL as an arg or set DEAL_WEBHOOK_URL.");
if (!secret || secret === "tgsec_changeme") {
  fail("Set a real DEAL_TELEGRAM_WEBHOOK_SECRET (not the sentinel) before registering.");
}

const r = await tg("setWebhook", {
  url,
  secret_token: secret,
  allowed_updates: ["message"],
  drop_pending_updates: true,
});
console.log("setWebhook →", JSON.stringify(r, null, 2));
if (!r.ok) process.exit(1);

const info = await tg("getWebhookInfo", {});
console.log("getWebhookInfo →", JSON.stringify(info.result, null, 2));
console.log(`\n✓ Webhook registered: ${url}`);
