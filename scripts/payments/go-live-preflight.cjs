// Go/no-go preflight for the application-fee money path. Reads the live api's
// state (Stripe account, keys, webhook, Resend, Pay-DTMF flags) and prints a
// green/red table. Read-only — changes nothing. Run via:
//   railway run node go-live-preflight.cjs
// (railway run injects the api service env: STRIPE_SECRET_KEY, RESEND_API_KEY,
//  STRIPE_WEBHOOK_SECRET, RESEND_FROM, PAY_DTMF_ENABLED, PAY_STRIPE_CONNECTOR…)
const WEBHOOK_URL = process.env.WEBHOOK_URL || "https://api-production-ed89.up.railway.app/api/payments/webhook";
const rows = [];
const add = (name, ok, detail) => rows.push({ name, ok, detail });
const fetchJson = async (url, headers) => {
  const r = await fetch(url, { headers });
  return { status: r.status, body: await r.json().catch(() => null) };
};

(async () => {
  const sk = process.env.STRIPE_SECRET_KEY || "";
  const mode = sk.startsWith("sk_live_") ? "live" : sk.startsWith("sk_test_") ? "test" : "none";
  add("Stripe key mode", mode === "live", `mode=${mode}`);

  if (sk) {
    try {
      const stripe = require("stripe")(sk);
      const acct = await stripe.accounts.retrieve();
      add("Stripe account activated", !!acct.charges_enabled, `${acct.id} charges_enabled=${acct.charges_enabled} details_submitted=${acct.details_submitted}`);
      const eps = await stripe.webhookEndpoints.list({ limit: 100 });
      const ep = eps.data.find((e) => e.url === WEBHOOK_URL);
      const needed = ["payment_intent.succeeded", "payment_intent.payment_failed", "charge.refunded"];
      const hasAll = ep && needed.every((n) => ep.enabled_events.includes(n) || ep.enabled_events.includes("*"));
      add("Webhook endpoint (this mode)", !!ep && ep.status === "enabled" && hasAll,
        ep ? `${ep.id} status=${ep.status} events=${ep.enabled_events.length}` : "not found for this key's mode");
    } catch (e) { add("Stripe API reachable", false, e.message); }
  }

  add("STRIPE_LIVE_ENABLED", process.env.STRIPE_LIVE_ENABLED === "true", process.env.STRIPE_LIVE_ENABLED || "(unset)");
  add("STRIPE_WEBHOOK_SECRET set", !!process.env.STRIPE_WEBHOOK_SECRET, process.env.STRIPE_WEBHOOK_SECRET ? "set" : "(unset)");

  // Resend: domain verified + RESEND_FROM not the sandbox
  const rk = process.env.RESEND_API_KEY || "";
  const from = process.env.RESEND_FROM || "";
  if (rk) {
    try {
      const { body } = await fetchJson("https://api.resend.com/domains", { Authorization: `Bearer ${rk}` });
      const verified = (body?.data || []).filter((d) => d.status === "verified").map((d) => d.name);
      add("Resend domain verified", verified.length > 0, verified.length ? verified.join(", ") : "no verified domains");
    } catch (e) { add("Resend reachable", false, e.message); }
  } else add("RESEND_API_KEY set", false, "(unset)");
  add("RESEND_FROM (not sandbox)", !!from && !from.includes("resend.dev"), from || "(unset)");

  // Pay-DTMF (the on-call <Pay> upgrade — optional for the link path)
  add("PAY_DTMF_ENABLED", process.env.PAY_DTMF_ENABLED === "true", process.env.PAY_DTMF_ENABLED || "(unset/dark)");
  add("PAY_STRIPE_CONNECTOR", !!process.env.PAY_STRIPE_CONNECTOR, process.env.PAY_STRIPE_CONNECTOR || "(default Stripe_Dev)");

  // Report
  const pad = (s, n) => (s + " ".repeat(n)).slice(0, n);
  console.log("\nGO-LIVE PREFLIGHT — application fee (emailed link path)\n" + "=".repeat(64));
  for (const r of rows) console.log(`  ${r.ok ? "✓" : "✗"}  ${pad(r.name, 30)} ${r.detail}`);
  console.log("=".repeat(64));
  const linkPathKeys = ["Stripe key mode", "Stripe account activated", "STRIPE_LIVE_ENABLED", "STRIPE_WEBHOOK_SECRET set", "Webhook endpoint (this mode)", "Resend domain verified", "RESEND_FROM (not sandbox)"];
  const blockers = rows.filter((r) => linkPathKeys.includes(r.name) && !r.ok).map((r) => r.name);
  console.log(blockers.length ? `LINK PATH: NOT READY — blockers: ${blockers.join(", ")}` : "LINK PATH: ✓ READY for live money");
  console.log("(PAY_DTMF_* is the optional on-call <Pay> upgrade, separate from the link path.)\n");
})().catch((e) => { console.error("preflight ERR:", e.message); process.exit(1); });
