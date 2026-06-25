// ONE-COMMAND go-live for the application-fee money path. Run this the moment the
// Stripe account is activated (charges_enabled=true) and you have the live key.
// It does the ENTIRE flip programmatically — no dashboard clicking beyond copying
// the live secret key:
//   1. verifies the key is sk_live_ AND the account is actually activated
//   2. creates the LIVE webhook endpoint (and captures the whsec_ itself)
//   3. sets the four Railway vars on the api service (which redeploys)
//   4. prints how to verify the live flip
//
// Run from the linked frank-pilot worktree:
//   STRIPE_LIVE_KEY=sk_live_xxx [RESEND_FROM="Frank <noreply@frankhousing.com>"] node go-live.cjs
const { execSync } = require("child_process");

const LIVE_KEY = process.env.STRIPE_LIVE_KEY;
const WEBHOOK_URL = process.env.WEBHOOK_URL || "https://api-production-ed89.up.railway.app/api/payments/webhook";
const RESEND_FROM = process.env.RESEND_FROM || "Frank <noreply@frankhousing.com>";
const EVENTS = ["payment_intent.succeeded", "payment_intent.payment_failed", "charge.refunded"];

function die(m) { console.error(`\n✗ ${m}\n`); process.exit(1); }
if (!LIVE_KEY) die("Set STRIPE_LIVE_KEY=sk_live_... (Stripe Dashboard → Live mode → Developers → API keys).");
if (!LIVE_KEY.startsWith("sk_live_")) die(`STRIPE_LIVE_KEY must start with sk_live_ (got ${LIVE_KEY.slice(0,8)}).`);

const stripe = require("stripe")(LIVE_KEY);

function rail(args) {
  // Sets a var WITHOUT echoing its value into the shell history/logs.
  return execSync(`railway variables -s api --set ${args}`, { stdio: ["ignore", "pipe", "pipe"] }).toString();
}

(async () => {
  // 1. confirm the account is genuinely live + activated
  const acct = await stripe.accounts.retrieve();
  console.log(`Account ${acct.id}: charges_enabled=${acct.charges_enabled} details_submitted=${acct.details_submitted}`);
  if (!acct.charges_enabled) {
    die("Account is NOT activated for live charges yet (charges_enabled=false). Finish Stripe onboarding first — this script can't bypass KYC.");
  }
  const bal = await stripe.balance.retrieve();
  if (!bal.livemode) die("Key did not resolve to live mode. Use the sk_live_ key.");
  console.log("✓ LIVE + activated.");

  // 2. create (or reuse) the live webhook endpoint and capture the signing secret
  let endpoint = null;
  const existing = await stripe.webhookEndpoints.list({ limit: 100 });
  endpoint = existing.data.find((e) => e.url === WEBHOOK_URL);
  let whsec = null;
  if (endpoint) {
    console.log(`• live webhook endpoint already exists: ${endpoint.id} — its secret is only shown at creation.`);
    console.log("  If you don't have its whsec_, delete it in the dashboard and re-run, or set STRIPE_WEBHOOK_SECRET manually.");
  } else {
    endpoint = await stripe.webhookEndpoints.create({ url: WEBHOOK_URL, enabled_events: EVENTS, description: "frank-pilot application fee (live)" });
    whsec = endpoint.secret; // shown ONCE, here
    console.log(`✓ created live webhook endpoint ${endpoint.id} (events: ${EVENTS.join(", ")})`);
  }

  // 3. flip the Railway vars (each set triggers a redeploy)
  console.log("\nSetting Railway vars on api …");
  rail(`"STRIPE_SECRET_KEY=${LIVE_KEY}"`);
  rail(`"STRIPE_LIVE_ENABLED=true"`);
  if (whsec) rail(`"STRIPE_WEBHOOK_SECRET=${whsec}"`);
  rail(`"RESEND_FROM=${RESEND_FROM}"`);
  console.log("✓ STRIPE_SECRET_KEY (live), STRIPE_LIVE_ENABLED=true" + (whsec ? ", STRIPE_WEBHOOK_SECRET (live)" : "") + ", RESEND_FROM set.");
  if (!whsec) console.log("⚠ STRIPE_WEBHOOK_SECRET NOT set (endpoint pre-existed) — set it manually if needed.");

  console.log("\n✓ GO-LIVE FLIP DONE. Railway is redeploying the api with the live key.");
  console.log("Verify with a real card on a real application once the deploy is healthy.");
  console.log(`(Webhook endpoint: ${endpoint.id} → ${WEBHOOK_URL})`);
})().catch((e) => die(e.message));
