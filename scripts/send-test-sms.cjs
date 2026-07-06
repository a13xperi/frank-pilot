#!/usr/bin/env node
// send-test-sms.cjs — text a 4-digit verification code to a number via Twilio, directly.
// Run with the prod env injected:  railway run node scripts/send-test-sms.cjs +17025550123
// Isolates the SMS pipeline from the voice agent + the webhook signature.
const to = process.argv[2];
if (!to || !to.startsWith("+")) {
  console.error("usage: node scripts/send-test-sms.cjs +1XXXXXXXXXX  (E.164)");
  process.exit(1);
}
const sid = process.env.TWILIO_ACCOUNT_SID;
const token = process.env.TWILIO_AUTH_TOKEN;
const from = process.env.TWILIO_PHONE_NUMBER;
const code = String(Math.floor(1000 + Math.random() * 9000));
console.log("Twilio configured:", !!(sid && token && sid !== "changeme"), "| FROM:", from || "(unset!)", "| TO:", to);
if (!sid || !token || sid === "changeme") {
  console.error("FAIL: TWILIO_ACCOUNT_SID/AUTH_TOKEN not set in this environment (this IS the bug).");
  process.exit(2);
}
if (!from) {
  console.error("FAIL: TWILIO_PHONE_NUMBER (the FROM) is unset (this IS the bug).");
  process.exit(2);
}
const client = require("twilio")(sid, token);
client.messages
  .create({ body: `Your Frank verification code is ${code}. (CLI test)`, from, to })
  .then((r) => console.log(`SENT ✓  sid=${r.sid}  status=${r.status}  (code texted: ${code})`))
  .catch((e) => {
    console.error(`SEND FAILED: ${e.message}  code=${e.code || "?"}  moreInfo=${e.moreInfo || ""}`);
    process.exit(3);
  });
