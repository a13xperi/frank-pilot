/**
 * service.ts — extractive (model-free) grounding for the hosted Deal-Room bot.
 *
 * Port of the compose-OFF branch of dealroom-telegram.py _ground_answer
 * (167-247): retrieve the top deal-corpus passages, format them as cited
 * snippets, and mask the joined text to the effective tier. No model call — the
 * masked, cited passages ARE the answer. This is the safest posture (zero
 * paraphrase / hallucination risk); generative compose stays a future flag.
 */
import { searchDealCorpus } from "./corpus";
import { guardAnswer, normalizeBrand, type DealTier } from "./compartment-guard";

const MAX_PASSAGES = 4;
const MAX_BODY = 500; // chars per cited passage

export interface GroundResult {
  ok: boolean;
  empty?: boolean;
  answer?: string;
  nSources?: number;
  withheld?: boolean;
  maskedClasses?: string[];
}

/**
 * A fast, cited answer from the deal corpus, masked to `tier`. Synchronous —
 * extractive retrieval is sub-millisecond, no engine dispatch.
 */
export function groundAnswer(question: string, tier: DealTier): GroundResult {
  const hits = searchDealCorpus(question, 5);
  if (hits.length === 0) return { ok: true, empty: true };

  const parts: string[] = [];
  let n = 0;
  for (const { entry } of hits.slice(0, MAX_PASSAGES)) {
    let body = (entry.answer || "").replace(/\s+/g, " ").trim();
    if (body.length > MAX_BODY) {
      body = body.slice(0, MAX_BODY).replace(/\s+\S*$/, "") + "…";
    }
    n += 1;
    parts.push(`[${n}] ${entry.section || "deal materials"}: ${body}`);
  }

  const g = guardAnswer(parts.join("\n\n"), tier);
  return {
    ok: true,
    answer: normalizeBrand(g.masked),
    nSources: n,
    withheld: !g.clean,
    maskedClasses: g.hits,
  };
}
