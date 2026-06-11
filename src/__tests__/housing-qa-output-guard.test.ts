/**
 * housing-qa-output-guard.test.ts — internal-language denylist for tenant-
 * facing answers.
 *
 * The retrieval allowlist keeps scoped-out DATA out of the model; this guard
 * keeps internal LANGUAGE out of the response. Prompt drift WILL eventually
 * reintroduce internal phrasing (it already did once — the 2026-06 demo leak:
 * "Frank-Pilot application, Pick step", "statewide HUD-LIHTC dataset"), so
 * the denylist is pinned here, term by term, at the response boundary.
 *
 * Fail-closed contract: ANY hit replaces the whole answer with the safe
 * fallback. Violations are reported as rule ids only (the answer text can
 * embed the user's question → never logged).
 */
import {
  finalizeAnswer,
  guardTenantAnswer,
  INTERNAL_LANGUAGE_DENYLIST,
  SAFE_FALLBACK_ANSWER,
} from "../modules/housing-qa/output-guard";
import { RETRIEVAL_POLICIES } from "../modules/housing-qa/retriever";

describe("output guard — leaking answers are denied (fail-closed)", () => {
  // One representative leaking sentence per denylist rule. If a rule is added
  // to the denylist without a case here, the coverage test below fails.
  const LEAKS: Array<[string, string]> = [
    [
      "brand-frank-pilot",
      "You can check this in the Frank-Pilot application.",
    ],
    [
      "pipeline-step",
      "Head to the Pick step to choose a property.",
    ],
    [
      "dataset-hud-lihtc",
      "That comes from the HUD-LIHTC dataset.",
    ],
    [
      "dataset-gpmg",
      "Contact GPMG for current availability.",
    ],
    [
      "dataset-statewide",
      "I found it in the statewide data.",
    ],
    [
      "dataset-available-now",
      "It's listed in the available-now feed.",
    ],
    [
      "internal-file",
      "Per apply.json, the fee is fixed.",
    ],
    [
      "internal-route",
      "Use the /discover map to see all properties.",
    ],
    [
      "context-jargon",
      "The injected context doesn't include that property.",
    ],
  ];

  it.each(LEAKS)("%s: denies and substitutes the safe fallback", (id, leak) => {
    const verdict = guardTenantAnswer(leak);
    expect(verdict.ok).toBe(false);
    expect(verdict.violations).toContain(id);
    expect(verdict.answer).toBe(SAFE_FALLBACK_ANSWER);
  });

  it("every denylist rule has a pinned leak case (no untested rules)", () => {
    const pinned = new Set(LEAKS.map(([id]) => id));
    for (const rule of INTERNAL_LANGUAGE_DENYLIST) {
      expect(pinned.has(rule.id)).toBe(true);
    }
  });

  it("separator and plural drift can't slip past the dataset rules", () => {
    // Each of these escaped the first denylist cut (single-separator [\s-],
    // singular-only alternations) — pinned so the patterns stay widened.
    const VARIANTS: Array<[string, string]> = [
      ["dataset-statewide", "That comes from our statewide datasets."],
      ["dataset-statewide", "I checked the statewide listings."],
      ["dataset-hud-lihtc", "It's in the HUD  LIHTC dataset."], // double space
      ["dataset-hud-lihtc", "Per HUDLIHTC records."], // no separator
      ["dataset-available-now", "See the available  now feed."], // double space
      ["dataset-available-now", "It's in the available-now listings."],
    ];
    for (const [id, leak] of VARIANTS) {
      const verdict = guardTenantAnswer(leak);
      expect(verdict.ok).toBe(false);
      expect(verdict.violations).toContain(id);
    }
  });

  it("the demo-leak phrasing is caught verbatim", () => {
    const verdict = guardTenantAnswer(
      "Test Property in Carson City is in our statewide HUD-LIHTC dataset. " +
        "To apply, open the Frank-Pilot application and continue to the Pick step."
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.violations).toEqual(
      expect.arrayContaining([
        "brand-frank-pilot",
        "pipeline-step",
        "dataset-hud-lihtc",
        "dataset-statewide",
      ])
    );
    expect(verdict.answer).toBe(SAFE_FALLBACK_ANSWER);
  });

  it("multiple violations are all reported (ids only, never the text)", () => {
    const verdict = guardTenantAnswer("GPMG keeps that in tenant-faq.json.");
    expect(verdict.violations.length).toBeGreaterThanOrEqual(2);
    for (const v of verdict.violations) {
      expect(typeof v).toBe("string");
      expect(v).not.toMatch(/GPMG|tenant-faq/);
    }
  });

  it("no denylist regex carries the /g flag (lastIndex statefulness)", () => {
    for (const rule of INTERNAL_LANGUAGE_DENYLIST) {
      expect(rule.re.flags).not.toContain("g");
    }
  });
});

describe("output guard — legitimate tenant answers pass untouched", () => {
  const GOOD_ANSWERS = [
    // grounded FAQ answers with citations — the pinned demo beats
    "SNAP benefits (food stamps) generally do not count as income for rent " +
      "calculations (Tenant FAQ #63). Your leasing office can confirm how " +
      "your household's income is reviewed.",
    "Yes — you can request a live-in aide as a reasonable accommodation " +
      "(Tenant FAQ #118–120). Policies vary by property, so verify with your " +
      "leasing office.",
    "The application fee is $35.95 per adult 18+, and it's non-refundable " +
      "(application fee).",
    // program names are NOT internal language
    "LIHTC is a federal affordable-housing program, and HUD publishes the " +
      "income limits it uses.",
    // everyday tenant guidance
    "Your application stays active for 120 days (120-day rule). After that, " +
      "you're invited to refresh it and continue.",
    "I don't have that information. Please contact your property's leasing " +
      "office for details.",
    // "step" in everyday usage is fine — only pipeline step NAMES are denied
    "The next step is to gather your documents and contact the leasing office.",
  ];

  it.each(GOOD_ANSWERS.map((a) => [a.slice(0, 48), a]))(
    "passes: %s…",
    (_label, answer) => {
      const verdict = guardTenantAnswer(answer);
      expect(verdict.ok).toBe(true);
      expect(verdict.answer).toBe(answer);
      expect(verdict.violations).toEqual([]);
    }
  );

  it("the safe fallback itself passes the guard (no self-trip)", () => {
    const verdict = guardTenantAnswer(SAFE_FALLBACK_ANSWER);
    expect(verdict.ok).toBe(true);
  });

  it("finalizeAnswer enforces per policy: tenant guarded, applicant pass-through", () => {
    const leak = "Open the Frank-Pilot application and go to the Pick step.";
    // tenant_public (guardOutput: true) → denied + fallback
    const tenant = finalizeAnswer(RETRIEVAL_POLICIES.tenant_public, leak);
    expect(tenant.ok).toBe(false);
    expect(tenant.answer).toBe(SAFE_FALLBACK_ANSWER);
    // applicant_portal (guardOutput: false) → untouched; Pick step / the
    // application pipeline are user-facing vocabulary on that surface
    const applicant = finalizeAnswer(RETRIEVAL_POLICIES.applicant_portal, leak);
    expect(applicant.ok).toBe(true);
    expect(applicant.answer).toBe(leak);
    expect(applicant.violations).toEqual([]);
  });

  it("no approved tenant-FAQ corpus answer trips the guard (zero false positives on real grounding)", () => {
    // The corpus is the ONLY retrieval source on the tenant surface — if any
    // entry tripped the denylist, a perfectly grounded answer quoting it
    // would be denied. Locked against the full 190-entry corpus.
    const corpus = require("../db/data/tenant-faq.json") as {
      entries: Array<{ id: string; question: string; answer: string }>;
    };
    expect(corpus.entries.length).toBeGreaterThan(0);
    for (const e of corpus.entries) {
      const verdict = guardTenantAnswer(`${e.question} ${e.answer}`);
      expect(verdict.violations).toEqual([]);
    }
  });
});
