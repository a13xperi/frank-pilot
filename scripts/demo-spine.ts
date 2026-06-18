/**
 * demo-spine.ts — DEV-ONLY, no DB, no deploy, no network.
 *
 * Exercises the new phone-first build's *pure* decision logic against Alex's
 * real failure cases so you can sanity-check "the new Frank" in one command:
 *
 *     cd ~/code/frank-pilot && npx ts-node --transpile-only scripts/demo-spine.ts
 *
 *   1. fuzzyMatchName  — the name spell-back matcher (the "Evans/Owens",
 *      "Shawana Hamomona" mishears) against a sample GPM-style roster.
 *   2. stepSms         — the text-only SMS intake conversation, start→done.
 *
 * Safe to run anytime: imports pure functions only, touches nothing external.
 */
import { fuzzyMatchName } from "../src/modules/voice-intake/name-matching";
import { stepSms } from "../src/modules/sms-intake/state-machine";

const roster = [
  { full_name: "Robert Owens" },
  { full_name: "Shawana Hamomona" },
  { full_name: "Jane Q Public" },
  { full_name: "Maria Gonzalez" },
];

const line = (s = "") => process.stdout.write(s + "\n");
const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n);

line("\n=== 1. Name spell-back match (fuzzyMatchName vs GPM roster) ===");
line(pad("heard", 22) + pad("spelled", 14) + pad("-> match", 22) + "conf   verdict");
line("-".repeat(72));
const cases: Array<[string, string, "reject" | "match"]> = [
  ["Evan Evans", "Evans", "reject"],         // Frank's "Evans/Owens" mishear → must NOT auto-accept Owens
  ["Robert Owens", "Owens", "match"],         // the real Owens → matches
  ["Shawana Hamamona", "Hamamona", "match"],  // ASR flub of Hamomona → still matches
  ["Shawana Hamomona", "Hamomona", "match"],  // exact → 1.0
  ["John Smith", "Smith", "reject"],          // not on roster → reject
];
let pass = 0;
for (const [heard, spelled, want] of cases) {
  const r = fuzzyMatchName(heard, spelled, roster);
  const got = r.match ? "match" : "reject";
  const ok = got === want;
  if (ok) pass++;
  line(
    pad(`"${heard}"`, 22) + pad(`"${spelled}"`, 14) +
    pad(r.match ? r.match.full_name : "(none)", 22) +
    pad(r.confidence.toFixed(2), 7) + (ok ? "OK " : "XX ") + want
  );
}
line(`\n  ${pass}/${cases.length} name cases behaved as expected`);

line("\n=== 2. Text-only SMS intake conversation (stepSms walk) ===");
let step: any = "start";
let collected: Record<string, string> = {};
const inbound = ["Hi", "Shawana Hamomona", "3", "$2,400", "Las Vegas"];
line("  (caller texts in; Frank replies — this is the full text-first intake)\n");
for (const msg of inbound) {
  const r = stepSms(step, collected, msg);
  line(`  caller> ${msg}`);
  line(`  frank > ${r.reply}`);
  line("");
  step = r.nextStep;
  collected = r.collected;
  if (r.done) break;
}
line("  captured fields:");
for (const [k, v] of Object.entries(collected)) line(`    ${pad(k, 16)} = ${v}`);
line(`  terminal step: ${step}\n`);
