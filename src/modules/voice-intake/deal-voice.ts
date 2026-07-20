/**
 * deal-voice.ts - voice-channel adapter over the deal-qa security core.
 *
 * The hosted Frank Deal Desk phone line lets an ENROLLED caller ask the deal
 * corpus a question out loud and hear a grounded, compartment-MASKED answer.
 * This is the thin, voice-specific layer on top of the SAME security core the
 * Telegram Deal-Room bot uses:
 *   - retrieval + masking: deal-qa/corpus.ts (searchDealCorpus) + deal-qa/
 *     compartment-guard.ts (guardAnswer / effectiveTier). Model-free and self-
 *     contained (no :9000), so it runs on Railway with no outbound dependency.
 *   - enrollment: a fail-closed PHONE allow-list, the voice sibling of deal-qa/
 *     enrollment.ts's chat allow-list. Reimplemented here (not imported) so the
 *     deal-qa module - under active dev on a sibling branch - stays untouched.
 *
 * VOICE-SPECIFIC SAFETY (why this is not just groundAnswer):
 *   1. FLOOR. Voice is leakier than text (a generative TTS agent can restate a
 *      figure). Every caller is masked at >= VOICE_DEAL_FLOOR (privileged), so no
 *      voice caller EVER gets the unmasked `internal` view, even one enrolled at
 *      internal/privileged. effectiveTier() can only tighten, never widen.
 *   2. PRE-MASK BEFORE THE MODEL. Passages are masked HERE, server-side, before
 *      the string reaches the ElevenLabs agent. At the privileged floor the econ
 *      class strips every $ and cent figure, so there is no number left for the
 *      agent to paraphrase or round.
 *   3. SPEAKABLE SENTINEL. guardAnswer emits the literal "[scoped]"; a TTS voice
 *      would read that as "scoped". We swap it (AFTER masking) for a spoken
 *      refusal fragment. The swap is a fixed safe phrase and cannot reintroduce a
 *      banned token.
 *   4. SHORT. Phone answers are 1-2 sentences, capped, no citation brackets/URLs.
 */
import { searchDealCorpus } from "../deal-qa/corpus";
import {
  guardAnswer,
  effectiveTier,
  isDealTier,
  type DealTier,
} from "../deal-qa/compartment-guard";

const STRICTEST: DealTier = "ext-generic";
const DEFAULT_FLOOR: DealTier = "privileged";

const MAX_PASSAGE_RAW = 320; // chars pulled from a passage BEFORE masking
const MAX_SPOKEN = 280; // chars of the final spoken string
const SPOKEN_SCOPED = "a detail I can't share on this line";
const MOSTLY_REDACTED =
  "I have some detail on that, but the specifics are outside what I can share on this line. I can have Alex follow up.";

/**
 * The compartment floor for the voice channel. Decision A (locked 2026-06-26):
 * `privileged` - masks internal names, cap-table, and ALL $/cent economics;
 * legal-structure terms stay allowed. Override with VOICE_DEAL_FLOOR to tighten
 * (e.g. "ext-named" to also mask the legal structure). An invalid value falls
 * back to privileged, never looser.
 */
export function voiceFloor(): DealTier {
  const raw = (process.env.VOICE_DEAL_FLOOR || "").trim();
  return isDealTier(raw) ? raw : DEFAULT_FLOOR;
}

export interface VoiceEnrollment {
  enrolled: boolean;
  tier: DealTier;
}

// Canonicalize a phone to a stable key. US-friendly: 10 digits -> +1XXXXXXXXXX,
// 11 digits starting 1 -> +1..., otherwise +<digits>. Applied to BOTH the
// allow-list entries and the incoming caller_id so "+1 (702) 555-0101",
// "702 555 0101" and "+17025550101" all match.
function normPhone(raw: string | number): string {
  const digits = String(raw ?? "").replace(/[^\d]/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

// Parse DEAL_QA_VOICE_ALLOWLIST="+17025550101:privileged,+17025550202:ext-named".
// Split each entry on the FIRST colon (phones can carry no colon), so a phone
// written with stray spaces still parses. Invalid/missing tier -> STRICTEST
// (fail-closed), never the loosest. Parsed fresh each call (the list is small and
// an env change restarts the Railway dyno anyway).
function parseVoiceAllowlist(raw: string): Map<string, DealTier> {
  const map = new Map<string, DealTier>();
  for (const part of (raw || "").split(",")) {
    const seg = part.trim();
    if (!seg) continue;
    const ci = seg.indexOf(":");
    const phone = normPhone(ci >= 0 ? seg.slice(0, ci) : seg);
    if (!phone) continue;
    const tierRaw = ci >= 0 ? seg.slice(ci + 1).trim() : "";
    map.set(phone, isDealTier(tierRaw) ? tierRaw : STRICTEST);
  }
  return map;
}

/**
 * Resolve a caller phone to its enrollment. Fail-closed: an unknown number is
 * NOT enrolled (the handler refuses, never answers); an enrolled number with a
 * missing/invalid tier resolves to the STRICTEST scoped tier, never `internal`.
 * Mirrors deal-qa/enrollment.ts.resolveEnrollment for the phone channel.
 */
export function resolveVoiceEnrollment(callerId: string | number): VoiceEnrollment {
  const phone = normPhone(callerId);
  if (!phone) return { enrolled: false, tier: STRICTEST };
  const tier = parseVoiceAllowlist(process.env.DEAL_QA_VOICE_ALLOWLIST || "").get(phone);
  if (tier === undefined) return { enrolled: false, tier: STRICTEST };
  return { enrolled: true, tier };
}

/** The enrolled caller phones (for an operator status read). */
export function enrolledVoiceCallers(): string[] {
  return [...parseVoiceAllowlist(process.env.DEAL_QA_VOICE_ALLOWLIST || "").keys()];
}

export interface VoiceAnswer {
  ok: boolean;
  empty?: boolean;
  spoken?: string;
  withheld?: boolean;
  maskedClasses?: string[];
  nSources?: number;
}

/**
 * A short, phone-speakable answer from the deal corpus, masked at the STRICTER of
 * the caller's tier and the voice floor. Model-free: retrieval + masking happen
 * before the string ever leaves the server. Returns {empty} when nothing matches
 * and a fail-closed {ok:false} if the guard hard-blocks (unknown tier).
 */
// Strip markdown + doc noise so the TTS reads a clean sentence, not "---" or
// "star Tokens star". Corpus passages are written for the eye; none of that
// (blockquotes, dividers, backtick `file.md` refs, arrows, checks) should be
// spoken. Learned live: a passage that was a "---" divider got read back as the
// entire answer. Runs BEFORE masking so the guard still sees figures/names.
function cleanForSpeech(text: string): string {
  return (text || "")
    .replace(/\bhttps?:\/\/\S+/gi, "")
    .replace(/`[^`]*`/g, "")
    .replace(/\b[\w-]+\.(?:md|json|ts|tsv|csv|pdf)\b/gi, "")
    .replace(/\[\d+\]/g, "")
    .replace(/[*_#>~|]/g, "")
    .replace(/-{2,}/g, " ")
    .replace(/[→➔➜]/g, " then ")
    .replace(/[✓✗•]/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function voiceGroundAnswer(question: string, tier: DealTier): VoiceAnswer {
  const eff = effectiveTier(tier, voiceFloor()); // floor can only tighten
  const hits = searchDealCorpus(question, 5);

  // Pick the FIRST hit with substantive PROSE after cleaning; skip passages that
  // are pure formatting (a "---" divider was being read back as the answer).
  // Clean BEFORE masking so the guard still sees the figures/names to redact.
  let raw = "";
  for (const h of hits) {
    const c = cleanForSpeech(h.entry.answer || "");
    if (c.replace(/[^a-z0-9]/gi, "").length >= 25) {
      raw = c;
      break;
    }
  }
  if (!raw) return { ok: true, empty: true };
  if (raw.length > MAX_PASSAGE_RAW) {
    raw = raw.slice(0, MAX_PASSAGE_RAW).replace(/\s+\S*$/, "") + "…";
  }

  const g = guardAnswer(raw, eff);
  if (g.blocked) return { ok: false, withheld: true, maskedClasses: g.hits };

  // Humanize the sentinel for TTS (AFTER masking; fixed safe phrase) and tidy.
  const scopedCount = (g.masked.match(/\[scoped\]/g) || []).length;
  let spoken = g.masked
    .replace(/\[scoped\]/g, SPOKEN_SCOPED)
    .replace(/\(\s*\)/g, "")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  // If the answer is mostly redactions, a choppy sentence helps no one - say one
  // clean deferral instead.
  const informative = spoken
    .split(SPOKEN_SCOPED)
    .join("")
    .replace(/[^a-z0-9]/gi, "").length;
  if (scopedCount >= 2 && informative < 40) spoken = MOSTLY_REDACTED;

  if (spoken.length > MAX_SPOKEN) {
    spoken = spoken.slice(0, MAX_SPOKEN).replace(/\s+\S*$/, "") + "…";
  }

  return {
    ok: true,
    spoken,
    withheld: !g.clean,
    maskedClasses: g.hits,
    nSources: 1,
  };
}
