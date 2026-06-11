/**
 * output-guard.ts — response-side internal-language guard for PUBLIC surfaces.
 *
 * The retrieval allowlist (retriever.ts) keeps scoped-out DATA away from the
 * model, but internal LANGUAGE can still drift in — the system prompt itself,
 * a future prompt edit, or model memory of common SaaS phrasing can surface
 * product names, pipeline step names, or dataset names in a tenant-facing
 * answer (the 2026-06 demo leak: "Frank-Pilot application, Pick step",
 * "statewide HUD-LIHTC dataset"). Prompt instructions alone cannot pin this —
 * prompt drift reintroduces it — so this guard enforces it at the response
 * boundary, where every answer must pass regardless of how it was produced.
 *
 * FAIL-CLOSED CONTRACT: any denylist hit replaces the ENTIRE answer with
 * SAFE_FALLBACK_ANSWER. No partial stripping — excising a phrase mid-sentence
 * yields garbled text, and a garbled answer still signals "there is something
 * here being hidden". The matched rule ids (never the answer text, which can
 * embed the user's question) are returned for logging.
 *
 * Tuning rule: every pattern must be language that can NEVER legitimately
 * appear in a tenant-facing answer. If a pattern starts tripping on good
 * answers, narrow the pattern — do not weaken the fail-closed behavior.
 */

export interface DenyRule {
  /** Stable id — what gets logged when the rule trips. */
  id: string;
  re: RegExp;
}

// NOTE: no /g flags — a global regex carries lastIndex state across .test()
// calls and would make results order-dependent.
export const INTERNAL_LANGUAGE_DENYLIST: readonly DenyRule[] = [
  // Product / project branding (internal on the tenant surface).
  { id: "brand-frank-pilot", re: /\bfrank[\s-]?pilot\b/i },
  // Application pipeline step names (Intent → Pick → Review → Confirm → Claim).
  { id: "pipeline-step", re: /\b(?:intent|pick|review|confirm|claim)\s+step\b/i },
  // Dataset names.
  { id: "dataset-hud-lihtc", re: /\bHUD[\s-]?LIHTC\b/i },
  { id: "dataset-gpmg", re: /\bGPMG\b/ },
  {
    id: "dataset-statewide",
    re: /\bstatewide\s+(?:hud|lihtc|dataset|data|feed|index|records?)\b/i,
  },
  {
    id: "dataset-available-now",
    re: /\bavailable[\s-]now\s+(?:feed|dataset|data|index|records?)\b/i,
  },
  // Repo file names (apply.json, faq.md, tenant-faq.json, …).
  { id: "internal-file", re: /\b[\w-]+\.(?:json|md|py|ts|mjs)\b/i },
  // Internal routes.
  { id: "internal-route", re: /\/discover\b|\/api\/housing-qa\b/i },
  // Context-payload / prompt-machinery jargon.
  {
    id: "context-jargon",
    re: /\b(?:propertyMode|tenantFaq|faqSections|_meta|always[\s-]on\s+facts?|context\s+payload|system\s+prompt|injected\s+context|grounding\s+(?:rules|contract))\b/i,
  },
] as const;

/**
 * What a guarded surface returns when an answer is denied. Must itself pass
 * the denylist (pinned by test) and stay generically useful.
 */
export const SAFE_FALLBACK_ANSWER =
  "I'm sorry — I can't help with that here. I can answer general " +
  "affordable-housing questions, like how income rules work, what documents " +
  "an application needs, or how leases and waitlists work. For anything " +
  "about a specific property, please contact that property's leasing office.";

export interface GuardResult {
  ok: boolean;
  /** Always safe to return to the client (the original answer, or the fallback). */
  answer: string;
  /** Ids of tripped rules — log these, never the answer text. */
  violations: string[];
}

/** Screen a model answer bound for a public tenant-facing surface. */
export function guardTenantAnswer(answer: string): GuardResult {
  const violations = INTERNAL_LANGUAGE_DENYLIST.filter((rule) =>
    rule.re.test(answer)
  ).map((rule) => rule.id);
  if (violations.length === 0) {
    return { ok: true, answer, violations };
  }
  return { ok: false, answer: SAFE_FALLBACK_ANSWER, violations };
}
